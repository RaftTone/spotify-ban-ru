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

$dir = getenv('SUBMISSIONS_DIR') ?: dirname($_SERVER['DOCUMENT_ROOT'] ?? __DIR__) . '/private_data';
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

$line = json_encode(['t' => gmdate('c'), 'ids' => $ids, 'note' => $note, 'ip' => substr($ipHash, 0, 12)], JSON_UNESCAPED_UNICODE);
file_put_contents($dir . '/submissions.jsonl', $line . "\n", FILE_APPEND | LOCK_EX);
reply(200, ['ok' => true, 'accepted' => count($ids)]);
