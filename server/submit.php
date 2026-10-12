<?php
// Приймач пропозицій виконавців зі сторінки rafttone.github.io/spotify-ban-ru.
// Нічого не публікує: лише дописує перевірені Spotify ID у приватний файл,
// який автор переглядає вручну (tools/review.py) перед додаванням у список.
declare(strict_types=1);

const ALLOWED_ORIGINS = ['https://rafttone.github.io'];
const MAX_IDS = 20;
const MAX_NOTE = 300;
const RATE_LIMIT = 20;      // пропозицій на годину з однієї адреси
const RATE_WINDOW = 3600;

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
}
header('Content-Type: application/json; charset=utf-8');

function reply(int $code, array $body): void {
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

// Сповіщення в Telegram, коли накопичилось достатньо нових виконавців.
// Налаштування лежать у <private_data>/config.json (НЕ в репозиторії):
//   {"telegram_token": "...", "telegram_chat": "...", "notify_threshold": 20}
// Без telegram_token/telegram_chat просто нічого не шле. Якщо відправка не вдалась,
// виконавці лишаються в черзі й сповіщення повториться при наступній пропозиції.
function tg_send(array $cfg, string $text): bool {
    $api = rtrim($cfg['telegram_api'] ?? 'https://api.telegram.org', '/');
    $url = $api . '/bot' . $cfg['telegram_token'] . '/sendMessage';
    $data = http_build_query(['chat_id' => $cfg['telegram_chat'], 'text' => $text, 'disable_web_page_preview' => 1]);
    $res = false;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $data, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_CONNECTTIMEOUT => 4]);
        $res = curl_exec($ch);
    } else {
        $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => "Content-Type: application/x-www-form-urlencoded\r\n", 'content' => $data, 'timeout' => 6]]);
        $res = @file_get_contents($url, false, $ctx);
    }
    $j = is_string($res) ? json_decode($res, true) : null;
    return is_array($j) && !empty($j['ok']);
}

function notify_if_needed(string $dir, array $ids, array $cfg): void {
    $threshold = max(1, (int)($cfg['notify_threshold'] ?? 20));
    $fh = fopen($dir . '/notify_state.json', 'c+');
    if (!$fh || !flock($fh, LOCK_EX)) return;
    $st = json_decode(stream_get_contents($fh) ?: '{}', true) ?: [];
    $st += ['seen' => [], 'pending' => []];
    foreach ($ids as $id) {
        if (!isset($st['seen'][$id])) { $st['seen'][$id] = time(); $st['pending'][$id] = 1; }
    }
    if (!empty($cfg['telegram_token']) && !empty($cfg['telegram_chat']) && count($st['pending']) >= $threshold) {
        $n = count($st['pending']);
        $text = "Spotify-бан: накопичилось нових виконавців на перевірку: $n.\n"
              . "Всього унікальних пропозицій: " . count($st['seen']) . ".\n"
              . "Забрати: submissions.jsonl з spotify_ban_private, переглянути: python3 tools/review.py submissions.jsonl";
        if (tg_send($cfg, $text)) $st['pending'] = [];
    }
    ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($st));
    flock($fh, LOCK_UN); fclose($fh);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') reply(405, ['ok' => false, 'error' => 'method']);
if ($origin !== '' && !in_array($origin, ALLOWED_ORIGINS, true)) reply(403, ['ok' => false, 'error' => 'origin']);

$raw = file_get_contents('php://input', false, null, 0, 8192);
$in = json_decode($raw ?: '', true);
if (!is_array($in)) reply(400, ['ok' => false, 'error' => 'json']);
if (!empty($in['hp'])) reply(200, ['ok' => true, 'accepted' => 0]); // пастка для ботів

$ids = [];
foreach ((array)($in['ids'] ?? []) as $id) {
    if (is_string($id) && preg_match('/^[A-Za-z0-9]{22}$/', $id)) $ids[$id] = true;
}
$ids = array_keys($ids);
if (!$ids) reply(422, ['ok' => false, 'error' => 'no_valid_ids']);
if (count($ids) > MAX_IDS) $ids = array_slice($ids, 0, MAX_IDS);
$note = mb_substr(trim(strip_tags((string)($in['note'] ?? ''))), 0, MAX_NOTE);

$dir = getenv('SUBMISSIONS_DIR') ?: dirname($_SERVER['DOCUMENT_ROOT'] ?? __DIR__) . '/spotify_ban_private';
if (!is_dir($dir) && !mkdir($dir, 0700, true)) reply(500, ['ok' => false, 'error' => 'storage']);

// сіль для хешу адреси; сама адреса не зберігається
$saltFile = $dir . '/.salt';
if (!is_file($saltFile)) file_put_contents($saltFile, bin2hex(random_bytes(16)));
$ipHash = hash('sha256', trim((string)file_get_contents($saltFile)) . ($_SERVER['REMOTE_ADDR'] ?? ''));

$rlFile = $dir . '/ratelimit.json';
$fh = fopen($rlFile, 'c+');
if (!$fh || !flock($fh, LOCK_EX)) reply(500, ['ok' => false, 'error' => 'storage']);
$rl = json_decode(stream_get_contents($fh) ?: '{}', true) ?: [];
$now = time();
foreach ($rl as $k => $times) {
    $rl[$k] = array_values(array_filter($times, fn($t) => $t > $now - RATE_WINDOW));
    if (!$rl[$k]) unset($rl[$k]);
}
if (count($rl[$ipHash] ?? []) >= RATE_LIMIT) { flock($fh, LOCK_UN); fclose($fh); reply(429, ['ok' => false, 'error' => 'rate_limit']); }
$rl[$ipHash][] = $now;
ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($rl));
flock($fh, LOCK_UN); fclose($fh);

$cfg = is_file($dir . '/config.json') ? (json_decode((string)file_get_contents($dir . '/config.json'), true) ?: []) : [];

$line = json_encode(['t' => gmdate('c'), 'ids' => $ids, 'note' => $note, 'ip' => substr($ipHash, 0, 12)], JSON_UNESCAPED_UNICODE);
file_put_contents($dir . '/submissions.jsonl', $line . "\n", FILE_APPEND | LOCK_EX);
notify_if_needed($dir, $ids, $cfg);
reply(200, ['ok' => true, 'accepted' => count($ids)]);
