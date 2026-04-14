<?php
// Server-side proxy for Google Generative Language API so the key stays out of
// the client bundle. Expects JSON body: { "model": "gemini-2.5-flash", "payload": {...} }
// Key is loaded from a sibling .env file (same format as the Vite .env).

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only']);
    exit;
}

$apiKey = getenv('GEMINI_API_KEY');
if (!$apiKey) {
    // Fallback: parse .env file in parent folder
    $envFile = __DIR__ . '/../.env.server';
    if (is_readable($envFile)) {
        foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            if (strpos($line, 'GEMINI_API_KEY=') === 0) {
                $apiKey = trim(substr($line, strlen('GEMINI_API_KEY=')));
                break;
            }
        }
    }
}
if (!$apiKey) {
    http_response_code(500);
    echo json_encode(['error' => 'GEMINI_API_KEY not configured on server']);
    exit;
}

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!$body || empty($body['model']) || empty($body['payload'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Expected {model, payload}']);
    exit;
}

$model = preg_replace('/[^a-zA-Z0-9\.\-]/', '', $body['model']);
$url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key=" . urlencode($apiKey);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode($body['payload']),
    CURLOPT_TIMEOUT => 120,
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);

if ($resp === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Upstream error: ' . $err]);
    exit;
}

http_response_code($code);
echo $resp;
