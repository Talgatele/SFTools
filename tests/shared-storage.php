<?php declare(strict_types = 1);

function verify(bool $condition, string $message): void
{
	if (!$condition) throw new RuntimeException($message);
	echo "PASS: $message\n";
}

$socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
if ($socket === false) throw new RuntimeException($error);
$address = stream_socket_get_name($socket, false);
fclose($socket);
$directory = sys_get_temp_dir() . '/sftools-library-test-' . bin2hex(random_bytes(8));
mkdir($directory, 0700);
$log = tmpfile();
$process = null;
$password = 'test-library-password-123';
$origin = 'https://satisfactory.bitstacker.dev';
$start = static function (string $password) use (&$process, $log, $address, $directory, $origin): void {
	$process = proc_open([PHP_BINARY, '-S', $address, '-t', __DIR__ . '/../deploy/web'], [0 => ['pipe', 'r'], 1 => $log, 2 => $log], $pipes, null,
		array_merge(getenv(), ['SFTOOLS_PASSWORD' => $password, 'SFTOOLS_ORIGIN' => $origin, 'SFTOOLS_DATA_DIR' => $directory]));
	if (!is_resource($process)) throw new RuntimeException('Could not start storage fixture');
	fclose($pipes[0]);
	for ($attempt = 0; $attempt < 100; $attempt++) {
		$probe = @stream_socket_client('tcp://' . $address, $errno, $error, 0.1);
		if ($probe !== false) { fclose($probe); return; }
		usleep(20000);
	}
	throw new RuntimeException('Storage fixture did not start');
};
$stop = static function () use (&$process): void {
	if (is_resource($process)) { proc_terminate($process); proc_close($process); $process = null; }
};
$request = static function (string $method, string $action, mixed $body = null, string $cookie = '', string $csrf = '', ?string $requestOrigin = 'default') use ($address, $origin): array {
	$headers = ['Content-Type: application/json'];
	if ($requestOrigin !== null) $headers[] = 'Origin: ' . ($requestOrigin === 'default' ? $origin : $requestOrigin);
	if ($cookie !== '') $headers[] = 'Cookie: ' . $cookie;
	if ($csrf !== '') $headers[] = 'X-SFTOOLS-CSRF: ' . $csrf;
	$context = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body === null ? '' : json_encode($body), 'ignore_errors' => true, 'follow_location' => 0, 'timeout' => 10]]);
	$text = file_get_contents('http://' . $address . '/server-storage.php?action=' . urlencode($action), false, $context);
	preg_match('/\s(\d{3})\s/', $http_response_header[0], $match);
	$responseHeaders = implode("\n", $http_response_header);
	preg_match('/Set-Cookie: ([^;\r\n]+)/i', $responseHeaders, $cookieMatch);
	return ['status' => (int) $match[1], 'body' => json_decode($text, true, 512, JSON_THROW_ON_ERROR), 'headers' => $responseHeaders, 'cookie' => $cookieMatch[1] ?? ''];
};
$value = static fn(string $name) => json_encode(['folders' => [], 'plans' => [['id' => 'plan-1', 'name' => $name]]]);
$key = 'sftools.plans.test-version';
try {
	$start($password);
	verify($request('GET', 'data')['status'] === 401, 'private plans require authentication');
	verify($request('GET', 'session')['body']['authenticated'] === false, 'anonymous session has no access');
	verify($request('POST', 'login', ['password' => $password], '', '', 'https://attacker.invalid')['status'] === 403, 'foreign origin cannot sign in');
	verify($request('POST', 'login', ['password' => $password], '', '', null)['status'] === 403, 'missing Origin is rejected for writes');
	verify($request('POST', 'login', ['password' => 'incorrect'])['status'] === 401, 'incorrect passwords rejected');
	$desktop = $request('POST', 'login', ['password' => $password]);
	$phone = $request('POST', 'login', ['password' => $password]);
	verify($desktop['status'] === 200 && $phone['status'] === 200, 'two devices can sign in to one library');
	verify(str_contains($desktop['cookie'], '__Host-sftools_library='), 'HTTPS session cookie uses host-only prefix');
	verify(str_contains($desktop['headers'], 'secure') && str_contains($desktop['headers'], 'HttpOnly') && str_contains($desktop['headers'], 'SameSite=Strict'), 'session cookie is Secure, HttpOnly and SameSite Strict');
	$cookie = $desktop['cookie']; $csrf = $desktop['body']['csrf'];
	$payload = ['key' => $key, 'value' => $value('Desktop plan'), 'revision' => 0];
	verify($request('PUT', 'data', $payload, $cookie)['status'] === 403, 'save requires a CSRF token');
	verify($request('PUT', 'data', $payload, $cookie, $csrf, 'https://attacker.invalid')['status'] === 403, 'save requires the configured same origin');
	$saved = $request('PUT', 'data', $payload, $cookie, $csrf);
	verify($saved['status'] === 200 && $saved['body']['revision'] === 1, 'first save committed with a revision');
	$fromPhone = $request('GET', 'data', null, $phone['cookie']);
	verify($fromPhone['body']['entries'][$key]['value'] === $value('Desktop plan'), 'separate device reads the saved plan');
	verify(str_contains($fromPhone['headers'], 'no-store, private'), 'private responses cannot be cached');
	$changed = ['key' => $key, 'value' => $value('Changed'), 'revision' => 1];
	verify($request('PUT', 'data', $changed, $cookie, $csrf)['body']['revision'] === 2, 'new edits advance the revision');
	$stale = ['key' => $key, 'value' => $value('Stale phone edit'), 'revision' => 1];
	verify($request('PUT', 'data', $stale, $phone['cookie'], $phone['body']['csrf'])['status'] === 409, 'stale devices cannot overwrite newer edits');
	verify($request('PUT', 'data', $changed, $cookie, $csrf)['body']['revision'] === 2, 'lost save acknowledgements can be retried without duplicating writes');
	verify($request('PUT', 'data', ['key' => 'sftools.settings', 'value' => '{}', 'revision' => 0], $cookie, $csrf)['status'] === 400, 'server accepts only library keys');
	verify($request('PUT', 'data', ['key' => $key, 'value' => 'null', 'revision' => 2], $cookie, $csrf)['status'] === 400, 'malformed plan stores rejected');
	verify($request('PUT', 'data', ['key' => $key, 'value' => json_encode(['plans' => [['id' => 'same'], ['id' => 'same']], 'folders' => []]), 'revision' => 2], $cookie, $csrf)['status'] === 400, 'duplicate plan IDs rejected');
	$revisions = $request('GET', 'revisions', null, $cookie)['body'];
	verify($revisions['entries'][$key] === 2, 'background revision checks work without downloading plans');
	verify($request('PUT', 'data', ['key' => $key, 'value' => null, 'revision' => 2], $cookie, $csrf)['body']['revision'] === 3, 'deletes preserve a revision tombstone');
	verify($request('PUT', 'data', $changed, $phone['cookie'], $phone['body']['csrf'])['status'] === 409, 'stale devices cannot resurrect a deleted plan');
	verify($request('PUT', 'data', ['key' => 'sftools.customVersions', 'value' => '["my-version"]', 'revision' => 0], $cookie, $csrf)['status'] === 200, 'custom game versions persist alongside plans');
	$instance = $request('GET', 'data', null, $cookie)['body']['instance'];
	$stop(); $start($password);
	$afterRestart = $request('GET', 'data', null, $cookie);
	verify($afterRestart['status'] === 200 && $afterRestart['body']['instance'] === $instance, 'library and sessions survive server process restart');
	verify($afterRestart['body']['entries']['sftools.customVersions']['value'] === '["my-version"]', 'saved content survives restart');
	verify($request('POST', 'logout', null, $cookie, $csrf)['status'] === 200, 'logout revokes the current device session');
	verify($request('GET', 'data', null, $cookie)['status'] === 401, 'logged-out cookie no longer grants access');
	verify($request('GET', 'data', null, $phone['cookie'])['status'] === 200, 'logging out one device leaves other devices signed in');
	$stop(); $start($password . '-rotated');
	verify($request('GET', 'data', null, $phone['cookie'])['status'] === 401, 'password rotation invalidates old sessions');
	$newSession = $request('POST', 'login', ['password' => $password . '-rotated']);
	verify($request('GET', 'data', null, $newSession['cookie'])['body']['instance'] === $instance, 'password rotation retains the library');
	for ($i = 0; $i < 20; $i++) $request('POST', 'login', ['password' => 'incorrect']);
	verify($request('POST', 'login', ['password' => 'incorrect'])['status'] === 429, 'password guessing is rate limited');
	verify((fileperms($directory . '/library.sqlite') & 0777) === 0600, 'database file is private to its owner');
} finally {
	$stop(); fclose($log);
	foreach (['library.sqlite', 'library.sqlite-wal', 'library.sqlite-shm'] as $file) if (is_file($directory . '/' . $file)) unlink($directory . '/' . $file);
	rmdir($directory);
}
