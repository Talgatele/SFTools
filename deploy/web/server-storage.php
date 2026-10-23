<?php declare(strict_types = 1);

final class LibraryHttpError extends RuntimeException
{
	public function __construct(public readonly int $status, string $message)
	{
		parent::__construct($message);
	}
}

/** Private, same-origin storage for this installation; unrelated to the public game-data API. */
final class SharedPlanLibrary
{
	private PDO $db;
	private string $password;
	private string $origin;
	private string $cookie;
	private const SESSION_SECONDS = 7 * 86400;
	private const MAX_BODY = 16 * 1024 * 1024;

	public function __construct()
	{
		$this->password = (string) getenv('SFTOOLS_PASSWORD');
		if (strlen($this->password) < 12) {
			throw new LibraryHttpError(503, 'Set SFTOOLS_PASSWORD to at least 12 characters on the server.');
		}
		$this->origin = rtrim((string) getenv('SFTOOLS_ORIGIN'), '/');
		$parts = parse_url($this->origin);
		if (!is_array($parts) || !isset($parts['host']) || isset($parts['user']) || isset($parts['pass'])
			|| !in_array($parts['scheme'] ?? '', ['https', 'http'], true)
			|| isset($parts['path']) || isset($parts['query']) || isset($parts['fragment'])
			|| ($parts['scheme'] === 'http' && !in_array($parts['host'], ['localhost', '127.0.0.1', '[::1]'], true))) {
			throw new LibraryHttpError(503, 'SFTOOLS_ORIGIN must be the HTTPS site origin (HTTP is allowed only on localhost).');
		}
		$this->cookie = $parts['scheme'] === 'https' ? '__Host-sftools_library' : 'sftools_library';
		$directory = (string) (getenv('SFTOOLS_DATA_DIR') ?: '/var/lib/sftools');
		if (!is_dir($directory) || !is_writable($directory)) {
			throw new LibraryHttpError(503, 'The server library data directory is not writable.');
		}
		umask(0077);
		$this->db = new PDO('sqlite:' . $directory . '/library.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
		$this->db->exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
		$this->db->exec('CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT, revision INTEGER NOT NULL);
			CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
			CREATE TABLE IF NOT EXISTS login_attempts (attempted INTEGER NOT NULL);');
		$this->db->prepare('INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)')->execute(['instance', bin2hex(random_bytes(16))]);
	}

	public function run(): void
	{
		$action = $_GET['action'] ?? 'session';
		$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
		if (!is_string($action)) throw new LibraryHttpError(400, 'Invalid action.');
		if ($method === 'GET' && $action === 'session') {
			$session = $this->session();
			$this->respond(['authenticated' => $session !== null, 'csrf' => $session['csrf'] ?? null]);
			return;
		}
		if ($method === 'POST' && $action === 'login') {
			$this->checkOrigin();
			$input = $this->body(2048);
			$this->login($input['password'] ?? null);
			return;
		}
		$session = $this->session();
		if ($session === null) throw new LibraryHttpError(401, 'Sign in to your server library.');
		if ($method === 'GET' && ($action === 'data' || $action === 'revisions')) {
			$entries = [];
			$columns = $action === 'data' ? 'key, value, revision' : 'key, revision';
			foreach ($this->db->query('SELECT ' . $columns . ' FROM documents') as $row) {
				$entries[$row['key']] = $action === 'data' ? ['value' => $row['value'], 'revision' => (int) $row['revision']] : (int) $row['revision'];
			}
			$instance = $this->db->query("SELECT value FROM metadata WHERE key='instance'")->fetchColumn();
			$this->respond(['instance' => $instance, 'entries' => (object) $entries]);
			return;
		}
		if ($method !== 'POST' && $method !== 'PUT') throw new LibraryHttpError(405, 'Method not allowed.');
		$this->checkOrigin();
		if (!hash_equals($session['csrf'], (string) ($_SERVER['HTTP_X_SFTOOLS_CSRF'] ?? ''))) {
			throw new LibraryHttpError(403, 'Your session changed. Sign in again before saving.');
		}
		if ($method === 'POST' && $action === 'logout') {
			$this->db->prepare('DELETE FROM sessions WHERE id=?')->execute([$session['id']]);
			$this->setCookie('', time() - 3600);
			$this->respond(['ok' => true]);
			return;
		}
		if ($method !== 'PUT' || $action !== 'data') throw new LibraryHttpError(404, 'Unknown storage action.');
		$input = $this->body(self::MAX_BODY);
		$key = $input['key'] ?? null;
		$value = $input['value'] ?? null;
		$revision = $input['revision'] ?? null;
		if (!is_string($key) || !self::allowedKey($key) || !is_int($revision) || $revision < 0
			|| (!is_string($value) && $value !== null)) {
			throw new LibraryHttpError(400, 'Invalid library document.');
		}
		if ($value !== null) $this->validateValue($key, $value);
		// One atomic compare-and-swap, including tombstones: stale devices cannot resurrect deleted data.
		$this->db->exec('BEGIN IMMEDIATE');
		try {
			$query = $this->db->prepare('SELECT value, revision FROM documents WHERE key=?');
			$query->execute([$key]);
			$current = $query->fetch(PDO::FETCH_ASSOC);
			if (($current === false ? 0 : (int) $current['revision']) !== $revision) {
				// A committed request whose acknowledgement was lost is safe to acknowledge again.
				if ($current !== false && $current['value'] === $value) {
					$this->db->exec('COMMIT');
					$this->respond(['revision' => (int) $current['revision']]);
					return;
				}
				throw new LibraryHttpError(409, 'Another device changed these plans. Your edits are still on this device.');
			}
			$this->db->prepare('INSERT INTO documents (key,value,revision) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, revision=excluded.revision')
				->execute([$key, $value, $revision + 1]);
			$this->db->exec('COMMIT');
		} catch (Throwable $error) {
			$this->db->exec('ROLLBACK');
			throw $error;
		}
		$this->respond(['revision' => $revision + 1]);
	}

	public static function allowedKey(string $key): bool
	{
		return $key === 'sftools.customVersions' || preg_match('/\Asftools\.plans(?:\.[A-Za-z0-9_.:-]{1,160})?\z/', $key) === 1;
	}

	private function validateValue(string $key, string $value): void
	{
		try { $data = json_decode($value, true, 128, JSON_THROW_ON_ERROR); }
		catch (JsonException) { throw new LibraryHttpError(400, 'The library document is not valid JSON.'); }
		if ($key === 'sftools.customVersions') {
			if (!is_array($data) || !array_is_list($data) || count(array_filter($data, 'is_string')) !== count($data)) {
				throw new LibraryHttpError(400, 'Invalid custom-version list.');
			}
		} elseif (!is_array($data) || !isset($data['plans'], $data['folders'])
			|| !is_array($data['plans']) || !array_is_list($data['plans']) || !is_array($data['folders']) || !array_is_list($data['folders'])) {
			throw new LibraryHttpError(400, 'Invalid plan library.');
		}
		if ($key !== 'sftools.customVersions') {
			$ids = [];
			foreach (array_merge($data['folders'], $data['plans']) as $entry) {
				if (!is_array($entry) || !is_string($entry['id'] ?? null) || isset($ids[$entry['id']])) throw new LibraryHttpError(400, 'Plan and folder IDs must be unique strings.');
				$ids[$entry['id']] = true;
			}
		}
	}

	private function session(): ?array
	{
		$token = $_COOKIE[$this->cookie] ?? '';
		if (!is_string($token) || preg_match('/\A[a-f0-9]{64}\z/', $token) !== 1) return null;
		$query = $this->db->prepare('SELECT * FROM sessions WHERE id=? AND expires>?');
		// Binding the opaque token to the configured password invalidates sessions on rotation,
		// without storing a password verifier or a reusable session token in the database.
		$query->execute([hash_hmac('sha256', $token, $this->password), time()]);
		return $query->fetch(PDO::FETCH_ASSOC) ?: null;
	}

	private function login(mixed $password): void
	{
		$this->db->prepare('DELETE FROM login_attempts WHERE attempted<?')->execute([time() - 3600]);
		$this->db->prepare('DELETE FROM sessions WHERE expires<?')->execute([time()]);
		$query = $this->db->prepare('SELECT COUNT(*) FROM login_attempts WHERE attempted>?');
		$query->execute([time() - 60]);
		if ((int) $query->fetchColumn() >= 20 || (int) $this->db->query('SELECT COUNT(*) FROM login_attempts')->fetchColumn() >= 200) {
			header('Retry-After: 60');
			throw new LibraryHttpError(429, 'Too many sign-in attempts. Please wait before trying again.');
		}
		if (!is_string($password) || strlen($password) > 1024 || !hash_equals(hash('sha256', $this->password), hash('sha256', $password))) {
			$this->db->prepare('INSERT INTO login_attempts (attempted) VALUES (?)')->execute([time()]);
			throw new LibraryHttpError(401, 'Incorrect library password.');
		}
		$token = bin2hex(random_bytes(32));
		$csrf = bin2hex(random_bytes(32));
		$expires = time() + self::SESSION_SECONDS;
		$this->db->prepare('INSERT INTO sessions (id,csrf,expires) VALUES (?,?,?)')
			->execute([hash_hmac('sha256', $token, $this->password), $csrf, $expires]);
		$this->setCookie($token, $expires);
		$this->respond(['authenticated' => true, 'csrf' => $csrf]);
	}

	private function setCookie(string $token, int $expires): void
	{
		setcookie($this->cookie, $token, ['expires' => $expires, 'path' => '/', 'secure' => str_starts_with($this->origin, 'https:'), 'httponly' => true, 'samesite' => 'Strict']);
	}

	private function checkOrigin(): void
	{
		if (!hash_equals($this->origin, (string) ($_SERVER['HTTP_ORIGIN'] ?? ''))) throw new LibraryHttpError(403, 'This request must come from the library website.');
	}

	private function body(int $limit): array
	{
		if (!str_starts_with(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')) throw new LibraryHttpError(415, 'JSON is required.');
		if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $limit) throw new LibraryHttpError(413, 'This save is too large. Export or split up some plans.');
		$stream = fopen('php://input', 'rb');
		$body = stream_get_contents($stream, $limit + 1);
		fclose($stream);
		if (!is_string($body) || strlen($body) > $limit) throw new LibraryHttpError(413, 'This save is too large.');
		try { $input = json_decode($body, true, 128, JSON_THROW_ON_ERROR); }
		catch (JsonException) { throw new LibraryHttpError(400, 'Invalid JSON request.'); }
		if (!is_array($input)) throw new LibraryHttpError(400, 'Invalid JSON request.');
		return $input;
	}

	private function respond(array $value): void
	{
		echo json_encode($value, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
	}
}

if (!defined('SFTOOLS_STORAGE_LIBRARY_ONLY')) {
	header('Content-Type: application/json; charset=utf-8');
	header('Cache-Control: no-store, private');
	header('X-Content-Type-Options: nosniff');
	try { (new SharedPlanLibrary())->run(); }
	catch (LibraryHttpError $error) {
		http_response_code($error->status);
		echo json_encode(['error' => $error->getMessage()]);
	} catch (Throwable $error) {
		error_log('Shared library: ' . $error->getMessage());
		http_response_code(503);
		echo json_encode(['error' => 'The server library is unavailable. Your browser copies have not been changed.']);
	}
}
