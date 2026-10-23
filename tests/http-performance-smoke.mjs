import assert from 'node:assert/strict';
import {get} from 'node:http';
import {gunzipSync} from 'node:zlib';

const origin = process.argv[2] ?? 'http://127.0.0.1:18082';
const host = process.argv[3];
const read = (path, encoding = 'identity') => new Promise((resolve, reject) => {
	get(new URL(path, origin), {headers: {'Accept-Encoding': encoding, ...(host ? {Host: host} : {})}}, response => {
		const chunks = [];
		response.on('data', chunk => chunks.push(chunk));
		response.on('end', () => resolve({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks)}));
		response.on('error', reject);
	}).on('error', reject);
});
const html = await read('/index.html');
assert.equal(html.status, 200);
const main = html.body.toString().match(/src="(main-[^"]+\.js)"/)?.[1];
assert.ok(main, 'production main bundle is linked');
const mainSource = await read(`/${main}`);
const layout = mainSource.body.toString().match(/chunk-[\w-]+\.js/)?.[0];
assert.ok(layout, 'lazy layout chunk is linked');
for (const path of [`/${main}`, `/${layout}`, '/assets/highs.js', '/assets/highs.wasm']) {
	const plain = await read(path);
	const compressed = await read(path, 'gzip');
	assert.equal(plain.status, 200);
	assert.equal(compressed.status, 200);
	assert.equal(compressed.headers['content-encoding'], 'gzip', `${path} is compressed`);
	assert.deepEqual(gunzipSync(compressed.body), plain.body, `${path} decompresses without corruption`);
	if (path.endsWith('.wasm')) assert.match(compressed.headers['content-type'], /application\/wasm/);
	console.log(`${path}: ${plain.body.length} -> ${compressed.body.length} wire bytes (${(100 * (1 - compressed.body.length / plain.body.length)).toFixed(1)}% smaller)`);
}
