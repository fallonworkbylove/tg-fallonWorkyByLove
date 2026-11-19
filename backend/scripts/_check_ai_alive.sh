#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

echo "=== process ==="
echo "pid=$(pm2 pid tgbot)"

echo
echo "=== OPENAI key ==="
python3 - <<'PY'
import re
env=open('.env','r',encoding='utf-8',errors='ignore').read()
m=re.search(r'^OPENAI_API_KEY=(.+)$', env, re.M)
if not m:
  print('MISSING')
else:
  k=m.group(1).strip().strip('"').strip("'")
  print(f'set len={len(k)} prefix={k[:8]}…')
PY

echo
echo "=== ping via bot openai client ==="
# load .env without breaking on PROXY_LIST multi-values: use dotenv in node
node scripts/_ping_openai.js

echo
echo "=== live OUT: recent model + replies ==="
pm2 logs tgbot --out --lines 150 --nostream 2>/dev/null | sed 's/^[^|]*| //' | grep -E 'Запрос к модели|Ответ для|AI не|молчу|invalid_api|401|429|insufficient' | tail -40

echo
echo "=== ERR (openai-ish) ==="
tail -60 /root/.pm2/logs/tgbot-error.log 2>/dev/null | grep -iE 'openai|api.?key|401|429|quota|ECONNREFUSED|fetch failed' | tail -15 || echo '(none)'

echo
echo "=== counts last 500 OUT ==="
OUT=$(pm2 logs tgbot --out --lines 500 --nostream 2>/dev/null | sed 's/^[^|]*| //')
echo -n "model_requests: "; echo "$OUT" | grep -c 'Запрос к модели' || true
echo -n "replies: "; echo "$OUT" | grep -c 'Ответ для' || true
echo -n "ai_silence: "; echo "$OUT" | grep -cE 'AI не дал|молчу \(без' || true
echo DONE
