<?php declare(strict_types = 1);

function check(bool $condition, string $message): void
{
	if (!$condition) {
		throw new RuntimeException($message);
	}
	echo "PASS: $message\n";
}

// Load the front controller without making a request to the public metadata API.
$_SERVER['REQUEST_METHOD'] = 'HEAD';
ob_start();
require __DIR__ . '/../deploy/web/index.php';
ob_end_clean();
$injector = new PageHeadInjector();
$invoke = static fn(string $method, ...$arguments) => (new ReflectionMethod($injector, $method))->invoke($injector, ...$arguments);

$_SERVER['HTTP_HOST'] = 'SATISFACTORY.BITSTACKER.DEV:80';
check($invoke('publicHost') === 'satisfactory.bitstacker.dev', 'public hostname normalized');
$_SERVER['HTTP_HOST'] = 'attacker.invalid';
check($invoke('publicHost') === 'satisfactory.bitstacker.dev', 'untrusted Host cannot poison previews');
check($invoke('canonicalPath', '/help?token=private&codex=item#anchor') === '/help?codex=item', 'canonical URL excludes secrets');
check($invoke('canonicalPath', '/help?codex[]=item') === '/help', 'array query values do not break metadata');

$socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
if ($socket === false) throw new RuntimeException($error);
$address = stream_socket_get_name($socket, false);
fclose($socket);
$log = tmpfile();
$process = proc_open([PHP_BINARY, '-S', $address, __DIR__ . '/fixtures/meta-router.php'], [
	0 => ['pipe', 'r'], 1 => $log, 2 => $log,
], $pipes);
if (!is_resource($process)) throw new RuntimeException('Could not start metadata fixture');
fclose($pipes[0]);
try {
	$ready = false;
	for ($attempt = 0; $attempt < 100; $attempt++) {
		$probe = @stream_socket_client('tcp://' . $address, $errno, $error, 0.1);
		if ($probe !== false) {
			fclose($probe);
			$ready = true;
			break;
		}
		usleep(20000);
	}
	check($ready, 'local metadata fixture ready');
	$fetch = static function (string $mode) use ($address, $invoke): ?array {
		$_SERVER['SFTOOLS_API_URL'] = 'http://' . $address . '/' . $mode;
		return $invoke('fetchMeta', '/help');
	};
	$meta = $fetch('ok');
	check(is_array($meta), 'valid metadata fetched');
	$html = $invoke('inject', '<html><head><meta charset="utf-8"><title>Default</title></head><body></body></html>', $meta, 'satisfactory.bitstacker.dev', '/help');
	check(!str_contains($html, '<script>') && str_contains($html, '&lt;script&gt;'), 'upstream HTML escaped in metadata');
	check(str_contains($html, 'og:url" content="https://satisfactory.bitstacker.dev/help"'), 'public URL rendered');
	check($fetch('oversized') === null, 'oversized metadata rejected');
	check($fetch('redirect') === null, 'metadata redirects never followed');
	check($fetch('failure') === null, 'upstream errors fall back to local metadata');
} finally {
	proc_terminate($process);
	proc_close($process);
	fclose($log);
}
