#!/bin/bash
# Light live audit — status, replies, flag phrases, err summary
set -u
OUT=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log

echo "=== PM2 ==="
pm2 jlist 2>/dev/null | python3 - <<'PY'
import sys, json, time
try:
    data = json.load(sys.stdin)
except Exception as e:
    print("pm2 jlist fail", e)
    sys.exit(0)
now = time.time() * 1000
for p in data:
    if p.get("name") != "tgbot":
        continue
    env = p.get("pm2_env") or {}
    up = env.get("pm_uptime") or 0
    mins = int((now - up) / 60000) if up else -1
    print(
        "status=%s restarts=%s uptime_min~%s" % (
            env.get("status"),
            env.get("restart_time"),
            mins,
        )
    )
PY

echo "=== DIGEST ==="
if [ -x /tmp/_watch_digest.sh ]; then
  bash /tmp/_watch_digest.sh 2>/dev/null | head -60
else
  echo "(no /tmp/_watch_digest.sh)"
fi

echo "=== LAST REPLIES (50) ==="
grep -E "Ответ для" "$OUT" 2>/dev/null | tail -50

echo "=== FLAG PHRASES (last 12k lines out) ==="
tail -n 12000 "$OUT" 2>/dev/null | grep -E "раньше ушло|не писать|это ладно|ну ок|TypeError|AUTH_KEY|переезжаю в|в Липецке|давно не был|пеоеезжаю|цифровая карточка|уже прочитал|источники счастья|запоминающимися" | tail -50

echo "=== ERR COUNTS (last 400 err lines) ==="
tail -n 400 "$ERR" 2>/dev/null | grep -oE "SocksClientError[^:]*|AUTH_KEY_[A-Z_]+|TypeError|FLOOD_WAIT|TIMEOUT|ECONNRESET|WebSocket connection failed" | sort | uniq -c | sort -rn | head -25

echo "=== BUSY / PAUSE (recent) ==="
tail -n 5000 "$OUT" 2>/dev/null | grep -E "Занята|catch-up|Catch-up|Пауза" | tail -25

echo "=== MODEL CALLS (last hour-ish: last 80) ==="
grep -E "Запрос к модели" "$OUT" 2>/dev/null | tail -8
echo "model_calls_in_last_2k_lines=$(tail -n 2000 "$OUT" 2>/dev/null | grep -c "Запрос к модели" || true)"
echo "replies_in_last_2k_lines=$(tail -n 2000 "$OUT" 2>/dev/null | grep -c "Ответ для" || true)"

echo "=== DONE ==="
