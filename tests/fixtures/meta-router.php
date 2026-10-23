<?php declare(strict_types = 1);

// Local fixture for web-security.php. Never copied into the runtime web root.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
header('Content-Type: application/json');
if (str_starts_with($path, '/redirect/')) {
	header('Location: /ok/v1/meta', true, 302);
	return;
}
if (str_starts_with($path, '/failure/')) {
	http_response_code(503);
	echo '{}';
	return;
}
echo json_encode([
	'title' => str_starts_with($path, '/oversized/') ? str_repeat('A', 70000) : '"><script>alert(1)</script>',
	'description' => 'A "quoted" description <img src=x onerror=alert(1)>',
	'image' => null,
	'kind' => 'default',
]);
