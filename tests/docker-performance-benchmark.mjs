// Run only against disposable benchmark containers; forces metadata to fail locally
// so timings don't depend on the public API. Images must already be built.
import {execFileSync, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {request, Agent} from 'node:http';
import {performance} from 'node:perf_hooks';

const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8'}).trim();
const execAsync = promisify(execFile);
async function measure(name, port) {
	docker('exec', name, 'sed', '-i', 's@https://api.new.satisfactorytools.com@http://127.0.0.1:9@g', '/var/www/html/.htaccess');
	const agent = new Agent({keepAlive: true, maxSockets: 32});
	const get = (path, retry = true) => new Promise((resolve, reject) => {
		const start = performance.now();
		const req = request({hostname: '127.0.0.1', port, path, agent}, res => {
			res.resume();
			res.on('end', () => res.statusCode === 200 ? resolve(performance.now() - start) : reject(new Error(`HTTP ${res.statusCode}`)));
		});
		req.setTimeout(15000, () => req.destroy(new Error('timeout')));
		// Apache may close a pooled connection between requests at the keep-alive deadline.
		req.on('error', error => {
			if (retry && req.reusedSocket && error.code === 'ECONNRESET') get(path, false).then(resolve, reject);
			else reject(error);
		});
		req.end();
	});
	console.log(`${name} idle: ${docker('stats', '--no-stream', '--format', '{{.MemUsage}}', name)}`);
	const times = [];
	let errors = 0;
	const errorCodes = {};
	const start = performance.now();
	const deadline = start + 10000;
	let peakBytes = 0;
	let sampling = false, sampleError = null;
	let pendingSample = Promise.resolve();
	const sample = setInterval(() => {
		// Sampling must not block the HTTP client loop or artificially expire pooled sockets.
		if (sampling) return;
		sampling = true;
		pendingSample = execAsync('docker', ['exec', name, 'sh', '-c', 'cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.stat'], {encoding: 'utf8'})
			.then(({stdout}) => {
				const total = Number(stdout.split('\n', 1)[0]);
				const inactive = Number(stdout.match(/^inactive_file (\d+)/m)?.[1] ?? 0);
				peakBytes = Math.max(peakBytes, total - inactive);
			}).catch(error => { sampleError = error; }).finally(() => { sampling = false; });
	}, 1000);
	try {
		await Promise.all(Array.from({length: 32}, async () => {
			while (performance.now() < deadline) {
				try { times.push(await get('/index.php')); }
				catch (error) {
					errors++;
					const code = error.code ?? error.message;
					errorCodes[code] = (errorCodes[code] ?? 0) + 1;
				}
			}
		}));
	} finally {
		clearInterval(sample);
		agent.destroy();
		await pendingSample;
	}
	if (sampleError) throw sampleError;
	times.sort((a, b) => a - b);
	console.log(`${name}: ${times.length} requests, ${errors} errors in ${((performance.now() - start) / 1000).toFixed(2)}s; sampled peak working set ${(peakBytes / 1024 / 1024).toFixed(2)} MiB; median ${times[Math.floor(times.length / 2)].toFixed(2)}ms; p95 ${times[Math.floor(times.length * .95)].toFixed(2)}ms`);
	console.log(`${name} after load: ${docker('stats', '--no-stream', '--format', '{{.MemUsage}}', name)}`);
	if (errors) console.log(errorCodes);
}
await measure('sftools-perf-before', 18081);
await measure('sftools-perf-after', 18082);
