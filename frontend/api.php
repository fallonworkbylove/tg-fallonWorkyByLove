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

// Токен бота для проверки Telegram WebApp initData
const BOT_TOKEN = ''; // BOT_TOKEN из .env

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
 * Проверка подписи initData по документации Telegram WebApp.
 */
function validate_telegram_init_data(string $initData, string $botToken): bool
{
    parse_str($initData, $data);
    if (!is_array($data) || empty($data['hash'])) {
        return false;
    }

    $checkHash = (string) $data['hash'];
    unset($data['hash']);
    ksort($data);

    $pairs = [];
    foreach ($data as $key => $value) {
        $pairs[] = $key . '=' . $value;
    }
    $dataCheckString = implode("\n", $pairs);

    $secretKey = hash_hmac('sha256', $botToken, 'WebAppData', true);
    $calculated = bin2hex(hash_hmac('sha256', $dataCheckString, $secretKey, true));

    return hash_equals($calculated, $checkHash);
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
        if (BOT_TOKEN !== '' && !validate_telegram_init_data($initData, BOT_TOKEN)) {
            json_response(['error' => 'invalid telegram signature'], 401);
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
    return [
        'id'         => (int) $row['id'],
        'worker_id'  => (string) $row['worker_id'],
        'name'       => $row['name'],
        'age'        => (int) $row['age'],
        'city'       => $row['city'],
        'bio'        => $row['bio'],
        'tg_link'    => $row['tg_link'],
        'photo_url'  => $row['photo_url'],
        'active'     => (int) $row['active'],
        'clicks'     => (int) $row['clicks'],
        'created_at' => $row['created_at'],
    ];
}

// --- Роутинг ---
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$body = request_body();

try {
    $pdo = db();

    switch ($action) {

        // 1) Один профиль (публично). Неактивный — ошибка, нет id — 404.
        case 'get_profile':
            if ($method !== 'GET') {
                json_response(['error' => 'method not allowed'], 405);
            }

            $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
            if ($id <= 0) {
                json_response(['error' => 'invalid id'], 400);
            }

            $stmt = $pdo->prepare(
                'SELECT id, worker_id, name, age, city, bio, tg_link, photo_url, active, clicks, created_at
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
                'SELECT id, worker_id, name, age, city, bio, tg_link, photo_url, active, clicks, created_at
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

                json_response(['success' => true, 'id' => $id]);
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

            json_response(['success' => true, 'id' => (int) $pdo->lastInsertId()]);

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

            $stmt = $pdo->prepare(
                'DELETE FROM profiles WHERE id = :id AND worker_id = :wid'
            );
            $stmt->execute([':id' => $id, ':wid' => $worker['id']]);

            if ($stmt->rowCount() === 0) {
                json_response(['error' => 'not found or forbidden'], 404);
            }

            json_response(['success' => true]);

        default:
            json_response(['error' => 'unknown action'], 400);
    }
} catch (PDOException $e) {
    json_response(['error' => 'database error'], 500);
} catch (Throwable $e) {
    json_response(['error' => 'server error'], 500);
}
