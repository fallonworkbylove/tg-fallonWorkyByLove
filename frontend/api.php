<?php
/**
 * API профилей знакомств (один файл).
 * Эндпоинты через ?action=...
 */

declare(strict_types=1);

// --- Настройки БД (поменяй под хостинг) ---
const DB_HOST = 'localhost';
const DB_PORT = '3306';
const DB_NAME = 'telegram_ai_miniapp';
const DB_USER = 'tgbot';
const DB_PASS = ''; // пароль с сервера
const DB_CHARSET = 'utf8mb4';

// false = не проверяем HMAC (часто ломается из‑за токена/.env у php-fpm).
// Достаточно user.id из initData + запись в workers. Mini App и так только в Telegram.
const STRICT_TELEGRAM_AUTH = false;
const BOT_TOKEN = ''; // нужно только если STRICT_TELEGRAM_AUTH = true

/**
 * Читает KEY=VALUE из .env файла.
 */
function env_from_file(string $path, string $key): string
{
    if (!is_readable($path)) {
        return '';
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return '';
    }
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
            continue;
        }
        [$name, $value] = explode('=', $line, 2);
        if (trim($name) !== $key) {
            continue;
        }
        $value = trim($value);
        if (
            (str_starts_with($value, '"') && str_ends_with($value, '"'))
            || (str_starts_with($value, "'") && str_ends_with($value, "'"))
        ) {
            $value = substr($value, 1, -1);
        }
        return trim($value);
    }
    return '';
}

function resolve_bot_token(): string
{
    // Сначала .env бэкенда — тот же токен, что у рабочего Mini App API
    $candidates = [
        __DIR__ . '/../backend/.env',
        dirname(__DIR__) . '/backend/.env',
        __DIR__ . '/../.env',
    ];
    foreach ($candidates as $path) {
        $token = env_from_file($path, 'BOT_TOKEN');
        if ($token !== '') {
            return $token;
        }
    }
    return trim(BOT_TOKEN);
}

/**
 * Значение из backend/.env (или рядом с api.php).
 */
function env_cfg(string $key, string $default = ''): string
{
    static $paths = null;
    if ($paths === null) {
        $paths = [
            __DIR__ . '/../backend/.env',
            dirname(__DIR__) . '/backend/.env',
            __DIR__ . '/../.env',
            __DIR__ . '/.env',
        ];
    }
    foreach ($paths as $path) {
        $value = env_from_file($path, $key);
        if ($value !== '') {
            return $value;
        }
    }
    return $default;
}

/**
 * Добавляет колонки коротких ссылок, если их ещё нет.
 */
function ensure_profiles_short_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    try {
        $cols = $pdo->query('SHOW COLUMNS FROM profiles')->fetchAll(PDO::FETCH_COLUMN);
        $have = array_flip(array_map('strval', $cols ?: []));

        if (!isset($have['slug'])) {
            $pdo->exec('ALTER TABLE profiles ADD COLUMN slug VARCHAR(64) NULL AFTER clicks');
        }
        if (!isset($have['short_url'])) {
            $pdo->exec('ALTER TABLE profiles ADD COLUMN short_url VARCHAR(255) NULL AFTER slug');
        }
        if (!isset($have['clck_link_id'])) {
            $pdo->exec('ALTER TABLE profiles ADD COLUMN clck_link_id INT NULL AFTER short_url');
        }

        $indexes = $pdo->query('SHOW INDEX FROM profiles WHERE Key_name = "uq_profiles_slug"')->fetchAll();
        if (!$indexes) {
            $pdo->exec('ALTER TABLE profiles ADD UNIQUE KEY uq_profiles_slug (slug)');
        }
    } catch (Throwable $e) {
        // Не валим API: сохранение анкеты продолжит работать без шорта.
        error_log('[profiles] schema migrate: ' . $e->getMessage());
    }
}

/**
 * Публичный origin лендинга (без слэша в конце).
 */
function public_base_url(): string
{
    $configured = rtrim(env_cfg('LANDING_PUBLIC_BASE'), '/');
    if ($configured !== '') {
        return $configured;
    }

    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443')
        || (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https');
    $scheme = $https ? 'https' : 'http';
    $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
    return $scheme . '://' . $host;
}

function landing_url_for_profile(int $profileId): string
{
    return public_base_url() . '/landing.html?profile=' . $profileId;
}

function transliterate_ru(string $text): string
{
    $map = [
        'а' => 'a', 'б' => 'b', 'в' => 'v', 'г' => 'g', 'д' => 'd', 'е' => 'e', 'ё' => 'e',
        'ж' => 'zh', 'з' => 'z', 'и' => 'i', 'й' => 'y', 'к' => 'k', 'л' => 'l', 'м' => 'm',
        'н' => 'n', 'о' => 'o', 'п' => 'p', 'р' => 'r', 'с' => 's', 'т' => 't', 'у' => 'u',
        'ф' => 'f', 'х' => 'h', 'ц' => 'ts', 'ч' => 'ch', 'ш' => 'sh', 'щ' => 'sch',
        'ъ' => '', 'ы' => 'y', 'ь' => '', 'э' => 'e', 'ю' => 'yu', 'я' => 'ya',
    ];
    $lower = mb_strtolower($text, 'UTF-8');
    $out = '';
    $len = mb_strlen($lower, 'UTF-8');
    for ($i = 0; $i < $len; $i++) {
        $ch = mb_substr($lower, $i, 1, 'UTF-8');
        $out .= $map[$ch] ?? $ch;
    }
    return $out;
}

/**
 * Человекочитаемый slug: alina23msk + случайный хвост при коллизии.
 */
function make_profile_slug(string $name, int $age, string $city = ''): string
{
    $base = transliterate_ru(trim($name));
    $base = preg_replace('/[^a-z0-9]+/i', '', $base) ?: 'girl';
    $base = strtolower(substr($base, 0, 12));
    $agePart = $age > 0 ? (string) $age : '';
    $cityPart = transliterate_ru(trim($city));
    $cityPart = preg_replace('/[^a-z0-9]+/i', '', $cityPart) ?: '';
    $cityPart = strtolower(substr((string) $cityPart, 0, 4));
    $slug = $base . $agePart . $cityPart;
    $slug = substr($slug, 0, 20);
    return $slug !== '' ? $slug : 'girl' . random_int(100, 999);
}

function unique_profile_slug(PDO $pdo, string $name, int $age, string $city, ?int $exceptId = null): string
{
    for ($attempt = 0; $attempt < 12; $attempt++) {
        $slug = make_profile_slug($name, $age, $city);
        if ($attempt > 0) {
            $slug = substr($slug, 0, 16) . random_int(10, 99) . ($attempt > 3 ? bin2hex(random_bytes(1)) : '');
        }
        $slug = strtolower(preg_replace('/[^a-z0-9]/', '', $slug) ?: ('g' . random_int(1000, 9999)));
        $sql = 'SELECT id FROM profiles WHERE slug = :slug';
        $params = [':slug' => $slug];
        if ($exceptId) {
            $sql .= ' AND id <> :id';
            $params[':id'] = $exceptId;
        }
        $sql .= ' LIMIT 1';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        if (!$stmt->fetch()) {
            return $slug;
        }
    }
    return 'p' . bin2hex(random_bytes(4));
}

/**
 * HTTP к clck.plus API.
 * @return array{ok:bool,status:int,json:?array,raw:string}
 */
function clck_request(string $method, string $path, array $form = []): array
{
    $apiKey = trim(env_cfg('CLCK_PLUS_API_KEY'));
    if ($apiKey === '') {
        return ['ok' => false, 'status' => 0, 'json' => null, 'raw' => 'CLCK_PLUS_API_KEY not set'];
    }

    $url = 'https://clck.plus/api/v1/' . ltrim($path, '/');
    $ch = curl_init($url);
    $headers = [
        'Accept: application/json',
        'Authorization: Bearer ' . $apiKey,
    ];

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => strtoupper($method),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);

    if ($form) {
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($form));
    }

    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($raw === false) {
        return ['ok' => false, 'status' => $status, 'json' => null, 'raw' => $err ?: 'curl failed'];
    }

    $json = json_decode($raw, true);
    return [
        'ok'     => $status >= 200 && $status < 300,
        'status' => $status,
        'json'   => is_array($json) ? $json : null,
        'raw'    => $raw,
    ];
}

function clck_domain_id(): int
{
    $configured = (int) env_cfg('CLCK_PLUS_DOMAIN_ID', '0');
    if ($configured > 0) {
        return $configured;
    }

    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }

    $res = clck_request('GET', 'domains?per_page=50');
    $list = $res['json']['data'] ?? $res['json'] ?? null;
    if (is_array($list)) {
        // data может быть пагинацией {data:[...]} или сразу массивом
        if (isset($list['data']) && is_array($list['data'])) {
            $list = $list['data'];
        }
        foreach ($list as $item) {
            if (is_array($item) && !empty($item['id'])) {
                $cached = (int) $item['id'];
                return $cached;
            }
        }
    }
    $cached = 0;
    return 0;
}

function clck_domain_host(): string
{
    $host = trim(env_cfg('CLCK_PLUS_DOMAIN_HOST'));
    if ($host !== '') {
        return preg_replace('#^https?://#', '', rtrim($host, '/'));
    }
    return 'clck.plus';
}

/**
 * Достаёт short URL / id из ответа clck.plus.
 * @return array{id:?int,short_url:?string,alias:?string}
 */
function clck_parse_link_payload(?array $json): array
{
    $node = $json;
    if (isset($json['data']) && is_array($json['data'])) {
        $node = $json['data'];
        // иногда data — список из одного элемента
        if (isset($node[0]) && is_array($node[0])) {
            $node = $node[0];
        }
    }

    if (!is_array($node)) {
        return ['id' => null, 'short_url' => null, 'alias' => null];
    }

    $id = isset($node['id']) ? (int) $node['id'] : null;
    $alias = isset($node['alias']) ? (string) $node['alias'] : (isset($node['slug']) ? (string) $node['slug'] : null);
    $short = $node['short_url'] ?? $node['short'] ?? $node['link'] ?? $node['url_short'] ?? null;
    if (is_string($short) && $short !== '') {
        return ['id' => $id, 'short_url' => $short, 'alias' => $alias];
    }

    if ($alias) {
        return [
            'id'        => $id,
            'short_url' => 'https://' . clck_domain_host() . '/' . ltrim($alias, '/'),
            'alias'     => $alias,
        ];
    }

    return ['id' => $id, 'short_url' => null, 'alias' => $alias];
}

/**
 * Создаёт или обновляет короткую ссылку clck.plus для анкеты.
 * @return array{slug:string,short_url:string,clck_link_id:?int,error:?string}
 */
function ensure_profile_short_link(PDO $pdo, array $profile, bool $forceNew = false): array
{
    $profileId = (int) $profile['id'];
    $name = (string) ($profile['name'] ?? '');
    $age = (int) ($profile['age'] ?? 0);
    $city = (string) ($profile['city'] ?? '');
    $slug = trim((string) ($profile['slug'] ?? ''));
    $shortUrl = trim((string) ($profile['short_url'] ?? ''));
    $clckId = isset($profile['clck_link_id']) && $profile['clck_link_id'] !== null && $profile['clck_link_id'] !== ''
        ? (int) $profile['clck_link_id']
        : 0;

    if ($slug === '' || $forceNew) {
        $slug = unique_profile_slug($pdo, $name, $age, $city, $profileId);
    }

    $target = landing_url_for_profile($profileId);
    $fallbackShort = landing_url_for_profile($profileId);
    $apiKey = trim(env_cfg('CLCK_PLUS_API_KEY'));

    if ($apiKey === '') {
        $pdo->prepare(
            'UPDATE profiles SET slug = :slug, short_url = :short, clck_link_id = NULL WHERE id = :id'
        )->execute([
            ':slug'  => $slug,
            ':short' => $fallbackShort,
            ':id'    => $profileId,
        ]);
        return [
            'slug'         => $slug,
            'short_url'    => $fallbackShort,
            'clck_link_id' => null,
            'error'        => 'CLCK_PLUS_API_KEY not set — used landing URL',
        ];
    }

    $domainId = clck_domain_id();
    if ($domainId <= 0) {
        $pdo->prepare(
            'UPDATE profiles SET slug = :slug, short_url = :short WHERE id = :id'
        )->execute([
            ':slug'  => $slug,
            ':short' => $shortUrl !== '' ? $shortUrl : $fallbackShort,
            ':id'    => $profileId,
        ]);
        return [
            'slug'         => $slug,
            'short_url'    => $shortUrl !== '' ? $shortUrl : $fallbackShort,
            'clck_link_id' => $clckId ?: null,
            'error'        => 'CLCK_PLUS_DOMAIN_ID missing — set domain id in .env',
        ];
    }

    $form = [
        'url'       => $target,
        'domain_id' => $domainId,
        'domain'    => $domainId,
        'alias'     => $slug,
        'title'     => trim($name . ($age ? ', ' . $age : '') . ($city ? ' · ' . $city : '')),
    ];

    $res = null;
    if ($clckId > 0 && !$forceNew) {
        $res = clck_request('PUT', 'links/' . $clckId, [
            'url'   => $target,
            'alias' => $slug,
            'title' => $form['title'],
        ]);
        if (!$res['ok']) {
            // ссылка могла удалиться в кабинете — создадим заново
            $clckId = 0;
        }
    }

    if ($clckId <= 0 || $forceNew) {
        if ($forceNew && $clckId > 0) {
            clck_request('DELETE', 'links/' . $clckId);
            $clckId = 0;
        }

        $created = false;
        for ($try = 0; $try < 5; $try++) {
            if ($try > 0) {
                $slug = unique_profile_slug($pdo, $name, $age, $city, $profileId);
                $form['alias'] = $slug;
            }
            $res = clck_request('POST', 'links', $form);
            if ($res['ok']) {
                $created = true;
                break;
            }
            // alias занят — пробуем другой
            $raw = strtolower($res['raw'] ?? '');
            if (!str_contains($raw, 'alias') && !str_contains($raw, 'занят') && $res['status'] !== 422) {
                break;
            }
        }

        if (!$created || !$res) {
            error_log('[clck.plus] create failed: ' . ($res['raw'] ?? 'no response'));
            $pdo->prepare(
                'UPDATE profiles SET slug = :slug, short_url = :short WHERE id = :id'
            )->execute([
                ':slug'  => $slug,
                ':short' => $shortUrl !== '' ? $shortUrl : $fallbackShort,
                ':id'    => $profileId,
            ]);
            return [
                'slug'         => $slug,
                'short_url'    => $shortUrl !== '' ? $shortUrl : $fallbackShort,
                'clck_link_id' => null,
                'error'        => 'clck.plus create failed',
            ];
        }
    }

    $parsed = clck_parse_link_payload($res['json'] ?? null);
    $newId = $parsed['id'] ?: ($clckId ?: null);
    $newShort = $parsed['short_url'] ?: ('https://' . clck_domain_host() . '/' . $slug);

    $pdo->prepare(
        'UPDATE profiles SET slug = :slug, short_url = :short, clck_link_id = :cid WHERE id = :id'
    )->execute([
        ':slug'  => $slug,
        ':short' => $newShort,
        ':cid'   => $newId,
        ':id'    => $profileId,
    ]);

    return [
        'slug'         => $slug,
        'short_url'    => $newShort,
        'clck_link_id' => $newId,
        'error'        => null,
    ];
}

function fetch_profile_row(PDO $pdo, int $id): ?array
{
    $stmt = $pdo->prepare(
        'SELECT id, worker_id, name, age, city, bio, tg_link, photo_url, active, clicks,
                slug, short_url, clck_link_id, created_at
         FROM profiles WHERE id = :id LIMIT 1'
    );
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Telegram-Init-Data, X-Worker-Id');
header('Content-Type: application/json; charset=utf-8');

// Preflight CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/**
 * Ответ JSON и выход.
 */
function json_response(mixed $data, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Подключение PDO.
 */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);

    return $pdo;
}

/**
 * Тело запроса как ассоциативный массив (JSON или form-data).
 */
function request_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw !== false && $raw !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }

    return is_array($_POST) ? $_POST : [];
}

/**
 * Значение заголовка без учёта регистра.
 */
function request_header(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (!empty($_SERVER[$key])) {
        return (string) $_SERVER[$key];
    }

    if (!empty($_SERVER['REDIRECT_' . $key])) {
        return (string) $_SERVER['REDIRECT_' . $key];
    }

    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $headerName => $value) {
            if (strcasecmp((string) $headerName, $name) === 0) {
                return (string) $value;
            }
        }
    }

    return '';
}

/**
 * Bearer-токен из заголовка Authorization.
 */
function bearer_token(): ?string
{
    $header = request_header('Authorization');

    if (preg_match('/^\s*Bearer\s+(.+?)\s*$/i', $header, $m)) {
        return trim($m[1]);
    }

    // Формат Telegram: Authorization: tma <initData>
    if (preg_match('/^\s*tma\s+(.+?)\s*$/i', $header, $m)) {
        return trim($m[1]);
    }

    return null;
}

/**
 * Сырая строка Telegram WebApp initData.
 */
function telegram_init_data(?array $body = null): ?string
{
    $fromHeader = request_header('X-Telegram-Init-Data');
    if ($fromHeader !== '') {
        return $fromHeader;
    }

    $bearer = bearer_token();
    if ($bearer !== null && str_contains($bearer, 'user=') && str_contains($bearer, 'hash=')) {
        return $bearer;
    }

    if (is_array($body) && !empty($body['initData']) && is_string($body['initData'])) {
        return $body['initData'];
    }

    if (!empty($_GET['initData']) && is_string($_GET['initData'])) {
        return $_GET['initData'];
    }

    return null;
}

/**
 * Проверка подписи initData — тот же алгоритм, что backend/middleware/telegramAuth.js
 */
function validate_telegram_init_data(string $initData, string $botToken): bool
{
    $botToken = trim($botToken);
    if ($botToken === '' || $initData === '') {
        return false;
    }

    // Как URLSearchParams в Node
    $params = [];
    foreach (explode('&', $initData) as $chunk) {
        if ($chunk === '') {
            continue;
        }
        $parts = explode('=', $chunk, 2);
        $key = rawurldecode(str_replace('+', ' ', $parts[0]));
        $value = isset($parts[1]) ? rawurldecode(str_replace('+', ' ', $parts[1])) : '';
        $params[$key] = $value;
    }

    if (empty($params['hash'])) {
        return false;
    }
    $hash = (string) $params['hash'];
    unset($params['hash']);

    // Telegram стал присылать signature — в data-check-string для HMAC его быть не должно
    unset($params['signature']);

    $pairs = [];
    foreach ($params as $key => $value) {
        $pairs[] = $key . '=' . $value;
    }
    sort($pairs, SORT_STRING);
    $dataCheckString = implode("\n", $pairs);

    $secretKey = hash_hmac('sha256', $botToken, 'WebAppData', true);
    $calculated = hash_hmac('sha256', $dataCheckString, $secretKey);

    if (!hash_equals($calculated, $hash)) {
        return false;
    }

    // Как в Node: initData старше суток — отклоняем
    if (!empty($params['auth_date'])) {
        $age = time() - (int) $params['auth_date'];
        if ($age > 86400) {
            return false;
        }
    }

    return true;
}

/**
 * user.id из initData (Telegram WebApp) как строка (BIGINT).
 */
function parse_telegram_user_id(string $initData): ?string
{
    parse_str($initData, $data);
    if (!is_array($data) || empty($data['user'])) {
        return null;
    }

    $user = json_decode((string) $data['user'], true);
    if (!is_array($user) || !isset($user['id'])) {
        return null;
    }

    $id = (string) $user['id'];
    return ctype_digit($id) && $id !== '0' ? $id : null;
}

/**
 * worker_id из query, body или заголовка X-Worker-Id (строка BIGINT).
 */
function resolve_worker_id(?array $body = null): ?string
{
    if (isset($_GET['worker_id']) && $_GET['worker_id'] !== '') {
        $id = (string) $_GET['worker_id'];
        return ctype_digit($id) ? $id : null;
    }

    if (is_array($body) && isset($body['worker_id']) && $body['worker_id'] !== '') {
        $id = (string) $body['worker_id'];
        return ctype_digit($id) ? $id : null;
    }

    if (!empty($_SERVER['HTTP_X_WORKER_ID'])) {
        $id = (string) $_SERVER['HTTP_X_WORKER_ID'];
        return ctype_digit($id) ? $id : null;
    }

    return null;
}

/**
 * Авторизация воркера:
 * 1) Telegram initData → workers.id = user.id
 * 2) либо классика: worker_id + Bearer token из таблицы workers
 *
 * @return array{id:int, login:string, token:string}
 */
function require_worker(PDO $pdo, ?array $body = null): array
{
    $initData = telegram_init_data($body);

    if ($initData !== null && $initData !== '') {
        if (STRICT_TELEGRAM_AUTH) {
            $botToken = resolve_bot_token();
            if ($botToken === '' || !validate_telegram_init_data($initData, $botToken)) {
                json_response(['error' => 'invalid telegram signature'], 401);
            }
        }

        $telegramId = parse_telegram_user_id($initData);
        if ($telegramId === null) {
            json_response(['error' => 'unauthorized'], 401);
        }

        // workers.id сопоставляется с Telegram user.id (BIGINT)
        $stmt = $pdo->prepare('SELECT id, login, token FROM workers WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $telegramId]);
        $worker = $stmt->fetch();

        if (!$worker) {
            json_response(['error' => 'worker not found'], 403);
        }

        return [
            'id'    => (string) $worker['id'],
            'login' => (string) $worker['login'],
            'token' => (string) $worker['token'],
        ];
    }

    $workerId = resolve_worker_id($body);
    $token = bearer_token();

    if ($workerId === null || $workerId === '' || $token === null || $token === '') {
        json_response(['error' => 'unauthorized'], 401);
    }

    $stmt = $pdo->prepare('SELECT id, login, token FROM workers WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $workerId]);
    $worker = $stmt->fetch();

    if (!$worker || !hash_equals((string) $worker['token'], $token)) {
        json_response(['error' => 'unauthorized'], 401);
    }

    return [
        'id'    => (string) $worker['id'],
        'login' => (string) $worker['login'],
        'token' => (string) $worker['token'],
    ];
}

/**
 * Публичные поля профиля для ответа.
 */
function profile_public(array $row): array
{
    $id = (int) $row['id'];
    $short = trim((string) ($row['short_url'] ?? ''));
    $landing = landing_url_for_profile($id);
    return [
        'id'          => $id,
        'worker_id'   => (string) $row['worker_id'],
        'name'        => $row['name'],
        'age'         => (int) $row['age'],
        'city'        => $row['city'],
        'bio'         => $row['bio'],
        'tg_link'     => $row['tg_link'],
        'photo_url'   => $row['photo_url'],
        'active'      => (int) $row['active'],
        'clicks'      => (int) $row['clicks'],
        'slug'        => $row['slug'] ?? null,
        'short_url'   => $short !== '' ? $short : $landing,
        'landing_url' => $landing,
        'created_at'  => $row['created_at'],
    ];
}

function send_no_store_headers(): void
{
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
}

// --- Роутинг ---
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$body = request_body();

try {
    $pdo = db();
    ensure_profiles_short_schema($pdo);

    switch ($action) {

        // 1) Один профиль (публично). Неактивный — ошибка, нет id — 404.
        case 'get_profile':
            if ($method !== 'GET') {
                json_response(['error' => 'method not allowed'], 405);
            }

            send_no_store_headers();

            $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
            if ($id <= 0) {
                json_response(['error' => 'invalid id'], 400);
            }

            $stmt = $pdo->prepare(
                'SELECT id, worker_id, name, age, city, bio, tg_link, photo_url, active, clicks,
                        slug, short_url, clck_link_id, created_at
                 FROM profiles WHERE id = :id LIMIT 1'
            );
            $stmt->execute([':id' => $id]);
            $row = $stmt->fetch();

            if (!$row) {
                json_response(['error' => 'not found'], 404);
            }

            if ((int) $row['active'] !== 1) {
                json_response(['error' => 'profile not available'], 403);
            }

            json_response(profile_public($row));

        // 2) Все профили воркера (нужна авторизация).
        case 'get_worker_profiles':
            if ($method !== 'GET') {
                json_response(['error' => 'method not allowed'], 405);
            }

            $worker = require_worker($pdo);
            // worker_id в query должен совпадать с авторизованным
            $requested = isset($_GET['worker_id']) && $_GET['worker_id'] !== ''
                ? (string) $_GET['worker_id']
                : (string) $worker['id'];
            if ($requested !== (string) $worker['id']) {
                json_response(['error' => 'forbidden'], 403);
            }

            $stmt = $pdo->prepare(
                'SELECT id, worker_id, name, age, city, bio, tg_link, photo_url, active, clicks,
                        slug, short_url, clck_link_id, created_at
                 FROM profiles WHERE worker_id = :wid ORDER BY id DESC'
            );
            $stmt->execute([':wid' => $worker['id']]);
            $rows = $stmt->fetchAll();

            json_response(array_map('profile_public', $rows));

        // 3) Создать / обновить профиль.
        case 'save_profile':
            if ($method !== 'POST') {
                json_response(['error' => 'method not allowed'], 405);
            }

            $worker = require_worker($pdo, $body);

            $id = isset($body['id']) && $body['id'] !== '' && $body['id'] !== null
                ? (int) $body['id']
                : 0;

            $name = trim((string) ($body['name'] ?? ''));
            $age = isset($body['age']) ? (int) $body['age'] : 0;
            $city = trim((string) ($body['city'] ?? ''));
            $bio = (string) ($body['bio'] ?? '');
            $tgLink = trim((string) ($body['tg_link'] ?? ''));
            $photoUrl = trim((string) ($body['photo_url'] ?? ''));
            $active = isset($body['active']) ? (int) ((bool) $body['active']) : 1;

            if ($name === '' || $age < 18 || $age > 45) {
                json_response(['error' => 'name required, age must be 18-45'], 400);
            }

            if ($id > 0) {
                // UPDATE только своего профиля
                $check = $pdo->prepare('SELECT id FROM profiles WHERE id = :id AND worker_id = :wid LIMIT 1');
                $check->execute([':id' => $id, ':wid' => $worker['id']]);
                if (!$check->fetch()) {
                    json_response(['error' => 'not found or forbidden'], 404);
                }

                $stmt = $pdo->prepare(
                    'UPDATE profiles SET
                        name = :name,
                        age = :age,
                        city = :city,
                        bio = :bio,
                        tg_link = :tg_link,
                        photo_url = :photo_url,
                        active = :active
                     WHERE id = :id AND worker_id = :wid'
                );
                $stmt->execute([
                    ':name'      => $name,
                    ':age'       => $age,
                    ':city'      => $city,
                    ':bio'       => $bio,
                    ':tg_link'   => $tgLink,
                    ':photo_url' => $photoUrl,
                    ':active'    => $active,
                    ':id'        => $id,
                    ':wid'       => $worker['id'],
                ]);

                $row = fetch_profile_row($pdo, $id);
                $shortMeta = ensure_profile_short_link($pdo, $row ?: ['id' => $id, 'name' => $name, 'age' => $age, 'city' => $city]);
                $row = fetch_profile_row($pdo, $id);
                json_response([
                    'success'    => true,
                    'id'         => $id,
                    'short_url'  => $shortMeta['short_url'],
                    'slug'       => $shortMeta['slug'],
                    'clck_error' => $shortMeta['error'],
                    'profile'    => $row ? profile_public($row) : null,
                ]);
            }

            // INSERT
            $stmt = $pdo->prepare(
                'INSERT INTO profiles (worker_id, name, age, city, bio, tg_link, photo_url, active, clicks)
                 VALUES (:wid, :name, :age, :city, :bio, :tg_link, :photo_url, :active, 0)'
            );
            $stmt->execute([
                ':wid'       => $worker['id'],
                ':name'      => $name,
                ':age'       => $age,
                ':city'      => $city,
                ':bio'       => $bio,
                ':tg_link'   => $tgLink,
                ':photo_url' => $photoUrl,
                ':active'    => $active,
            ]);

            $newId = (int) $pdo->lastInsertId();
            $row = fetch_profile_row($pdo, $newId);
            $shortMeta = ensure_profile_short_link($pdo, $row ?: [
                'id' => $newId, 'name' => $name, 'age' => $age, 'city' => $city,
            ]);
            $row = fetch_profile_row($pdo, $newId);
            json_response([
                'success'    => true,
                'id'         => $newId,
                'short_url'  => $shortMeta['short_url'],
                'slug'       => $shortMeta['slug'],
                'clck_error' => $shortMeta['error'],
                'profile'    => $row ? profile_public($row) : null,
            ]);

        // 3c) Пересоздать короткую ссылку clck.plus для анкеты.
        case 'refresh_short_link':
            if ($method !== 'POST') {
                json_response(['error' => 'method not allowed'], 405);
            }

            $worker = require_worker($pdo, $body);
            $id = isset($_GET['id']) ? (int) $_GET['id'] : (int) ($body['id'] ?? 0);
            if ($id <= 0) {
                json_response(['error' => 'invalid id'], 400);
            }

            $row = fetch_profile_row($pdo, $id);
            if (!$row || (string) $row['worker_id'] !== (string) $worker['id']) {
                json_response(['error' => 'not found or forbidden'], 404);
            }

            $shortMeta = ensure_profile_short_link($pdo, $row, true);
            $row = fetch_profile_row($pdo, $id);
            json_response([
                'success'    => true,
                'id'         => $id,
                'short_url'  => $shortMeta['short_url'],
                'slug'       => $shortMeta['slug'],
                'clck_error' => $shortMeta['error'],
                'profile'    => $row ? profile_public($row) : null,
            ]);

        // 3b) Загрузка фото анкеты (multipart/form-data, поле photo).
        case 'upload_photo':
            if ($method !== 'POST') {
                json_response(['error' => 'method not allowed'], 405);
            }

            $worker = require_worker($pdo, $body);

            if (empty($_FILES['photo']) || !is_array($_FILES['photo'])) {
                json_response(['error' => 'photo file required'], 400);
            }

            $file = $_FILES['photo'];
            $uploadError = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
            if ($uploadError !== UPLOAD_ERR_OK) {
                $uploadErrors = [
                    UPLOAD_ERR_INI_SIZE   => 'file exceeds php upload_max_filesize',
                    UPLOAD_ERR_FORM_SIZE  => 'file too large',
                    UPLOAD_ERR_PARTIAL    => 'partial upload',
                    UPLOAD_ERR_NO_FILE    => 'no file',
                    UPLOAD_ERR_NO_TMP_DIR => 'no tmp dir',
                    UPLOAD_ERR_CANT_WRITE => 'php cannot write temp file',
                    UPLOAD_ERR_EXTENSION  => 'blocked by extension',
                ];
                json_response([
                    'error' => $uploadErrors[$uploadError] ?? ('upload error ' . $uploadError),
                ], 400);
            }

            $maxBytes = 20 * 1024 * 1024; // 20 MB
            if (($file['size'] ?? 0) <= 0 || ($file['size'] ?? 0) > $maxBytes) {
                json_response(['error' => 'file too large (max 20MB)'], 400);
            }

            $tmp = (string) ($file['tmp_name'] ?? '');
            if ($tmp === '' || !is_uploaded_file($tmp)) {
                json_response(['error' => 'invalid upload'], 400);
            }

            $mime = '';
            if (class_exists('finfo')) {
                $finfo = new finfo(FILEINFO_MIME_TYPE);
                $mime = (string) $finfo->file($tmp);
            }
            if ($mime === '' || $mime === 'application/octet-stream') {
                $imageInfo = @getimagesize($tmp);
                $mime = is_array($imageInfo) && !empty($imageInfo['mime'])
                    ? (string) $imageInfo['mime']
                    : (string) ($file['type'] ?? '');
            }

            $allowed = [
                'image/jpeg' => 'jpg',
                'image/jpg'  => 'jpg',
                'image/pjpeg' => 'jpg',
                'image/png'  => 'png',
                'image/webp' => 'webp',
            ];
            if (!isset($allowed[$mime])) {
                json_response(['error' => 'only jpg, jpeg, png, webp allowed'], 400);
            }

            $dir = __DIR__ . '/uploads/profiles';
            if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
                json_response(['error' => 'cannot create upload dir: ' . $dir], 500);
            }
            @chmod($dir, 0775);

            if (!is_writable($dir)) {
                json_response([
                    'error' => 'upload dir not writable (fix permissions for php-fpm user)',
                    'dir'   => $dir,
                ], 500);
            }

            $filename = 'w' . preg_replace('/\D+/', '', (string) $worker['id'])
                . '_' . date('YmdHis') . '_' . bin2hex(random_bytes(4))
                . '.' . $allowed[$mime];
            $dest = $dir . '/' . $filename;

            $saved = @move_uploaded_file($tmp, $dest);
            if (!$saved) {
                $saved = @copy($tmp, $dest);
                if ($saved) {
                    @unlink($tmp);
                }
            }
            if (!$saved || !is_file($dest)) {
                json_response([
                    'error' => 'save failed (check uploads/profiles permissions)',
                    'dir'   => $dir,
                ], 500);
            }
            @chmod($dest, 0644);

            $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
                || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
            $scheme = $https ? 'https' : 'http';
            $host = $_SERVER['HTTP_HOST'] ?? 'loverussian.duckdns.org';
            $photoUrl = $scheme . '://' . $host . '/uploads/profiles/' . $filename;

            json_response([
                'success'   => true,
                'photo_url' => $photoUrl,
            ]);

        // 4) +1 к кликам (публично, для кнопки на лендинге).
        case 'increment_click':
            if ($method !== 'POST') {
                json_response(['error' => 'method not allowed'], 405);
            }

            $id = isset($_GET['id']) ? (int) $_GET['id'] : (int) ($body['id'] ?? 0);
            if ($id <= 0) {
                json_response(['error' => 'invalid id'], 400);
            }

            $stmt = $pdo->prepare(
                'UPDATE profiles SET clicks = clicks + 1 WHERE id = :id AND active = 1'
            );
            $stmt->execute([':id' => $id]);

            if ($stmt->rowCount() === 0) {
                // Проверим, есть ли вообще такой профиль
                $check = $pdo->prepare('SELECT id, active FROM profiles WHERE id = :id LIMIT 1');
                $check->execute([':id' => $id]);
                $row = $check->fetch();
                if (!$row) {
                    json_response(['error' => 'not found'], 404);
                }
                json_response(['error' => 'profile not available'], 403);
            }

            $get = $pdo->prepare('SELECT clicks FROM profiles WHERE id = :id LIMIT 1');
            $get->execute([':id' => $id]);
            $clicks = (int) $get->fetchColumn();

            json_response(['success' => true, 'clicks' => $clicks]);

        // 5) Удаление только своего профиля.
        case 'delete_profile':
            if ($method !== 'POST') {
                json_response(['error' => 'method not allowed'], 405);
            }

            $worker = require_worker($pdo, $body);
            $id = isset($_GET['id']) ? (int) $_GET['id'] : (int) ($body['id'] ?? 0);
            if ($id <= 0) {
                json_response(['error' => 'invalid id'], 400);
            }

            $row = fetch_profile_row($pdo, $id);
            if (!$row || (string) $row['worker_id'] !== (string) $worker['id']) {
                json_response(['error' => 'not found or forbidden'], 404);
            }

            $clckId = isset($row['clck_link_id']) ? (int) $row['clck_link_id'] : 0;

            $stmt = $pdo->prepare(
                'DELETE FROM profiles WHERE id = :id AND worker_id = :wid'
            );
            $stmt->execute([':id' => $id, ':wid' => $worker['id']]);

            if ($stmt->rowCount() === 0) {
                json_response(['error' => 'not found or forbidden'], 404);
            }

            if ($clckId > 0) {
                clck_request('DELETE', 'links/' . $clckId);
            }

            json_response(['success' => true]);

        // Диагностика clck.plus (только для авторизованного воркера).
        case 'clck_status':
            if ($method !== 'GET') {
                json_response(['error' => 'method not allowed'], 405);
            }
            require_worker($pdo);
            $keySet = trim(env_cfg('CLCK_PLUS_API_KEY')) !== '';
            $domainId = $keySet ? clck_domain_id() : 0;
            $domains = null;
            if ($keySet) {
                $res = clck_request('GET', 'domains?per_page=50');
                $domains = [
                    'ok'     => $res['ok'],
                    'status' => $res['status'],
                    'body'   => $res['json'],
                ];
            }
            json_response([
                'configured'   => $keySet,
                'domain_id'    => $domainId,
                'domain_host'  => clck_domain_host(),
                'landing_base' => public_base_url(),
                'domains'      => $domains,
            ]);

        default:
            json_response(['error' => 'unknown action'], 400);
    }
} catch (PDOException $e) {
    json_response(['error' => 'database error'], 500);
} catch (Throwable $e) {
    json_response(['error' => 'server error'], 500);
}
