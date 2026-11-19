#!/bin/bash
set -euo pipefail
echo "=== PM2 ==="
pm2 jlist > /tmp/pm2_jlist_0ga.json
python3 - <<'PY'
import json, time
from pathlib import Path
data=json.loads(Path('/tmp/pm2_jlist_0ga.json').read_text())
p=[x for x in data if x.get("name")=="tgbot"][0]
e=p["pm2_env"]
pl=(e.get("PROXY_LIST") or "")
uptime_ms = int(time.time()*1000) - int(e.get("pm_uptime") or 0)
print({
  "status": e.get("status"),
  "pid": p.get("pid"),
  "restarts": e.get("restart_time"),
  "proxy": len([x for x in pl.split(";") if x.strip()]),
  "uptime_min": round(uptime_ms/60000, 1),
})
PY
echo "=== PROXY pool ==="
grep "Work (DC) пул" /root/.pm2/logs/tgbot-out.log | tail -1 || true
echo "=== recent replies (last 40) ==="
grep -E "Ответ для|Catch-up|Отложенный ответ|outbound " /root/.pm2/logs/tgbot-out.log | tail -40 || true
echo "=== recent err (filtered) ==="
tail -n 120 /root/.pm2/logs/tgbot-error.log | grep -iE "Error|ReferenceError|TypeError|OPENAI|ECONN|timeout|Invalid" | tail -25 || echo "(none)"
echo "=== AI fail lines ==="
grep -E "AI не дал|пустой промпт|не отвечаю|молчу \(без" /root/.pm2/logs/tgbot-out.log | tail -15 || echo "(none)"
echo "=== sessions connect ==="
grep -E "Connection complete|connected|Authorization|WebSocket connection failed" /root/.pm2/logs/tgbot-out.log | tail -15 || true
echo "=== count replies last log chunk ==="
python3 - <<'PY'
from pathlib import Path
import re, time
p=Path('/root/.pm2/logs/tgbot-out.log')
# rough: last 2MB
data=p.read_bytes()[-2_000_000:].decode('utf-8','replace')
n=len(re.findall(r'Ответ для|Отложенный ответ для', data))
print('reply_hits_in_last_2MB', n)
# timestamps if present in lines? often not — just report count
PY
echo CHECK_AI_DONE
