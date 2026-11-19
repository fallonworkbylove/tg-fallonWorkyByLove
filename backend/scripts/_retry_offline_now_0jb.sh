#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
TOK=$(python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^ADMIN_CONSOLE_TOKEN=(.*)$',t,re.M)
print((m.group(1).strip().strip('"').strip("'") if m else ''))
PY
)
if [ -z "$TOK" ]; then echo 'NO_ADMIN_TOKEN'; exit 1; fi
echo "token_len=${#TOK}"

echo "health before:"
curl -sS http://127.0.0.1:3000/api/health; echo

IDS=(8 23 24 27 29 30 31 35 36 3)
for id in "${IDS[@]}"; do
  echo "=== retry id=$id ==="
  code=$(curl -sS -o /tmp/retry_$id.json -w '%{http_code}' \
    -X POST "http://127.0.0.1:3000/api/admin/console/accounts/${id}/start-ai" \
    -H "X-Admin-Console-Token: ${TOK}" \
    -H 'Content-Type: application/json' || true)
  echo "http=$code body=$(head -c 240 /tmp/retry_$id.json 2>/dev/null || true)"
  sleep 3
done

echo "health after:"
curl -sS http://127.0.0.1:3000/api/health; echo
echo DONE_RETRY
