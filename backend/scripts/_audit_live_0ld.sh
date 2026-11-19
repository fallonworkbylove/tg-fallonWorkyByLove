#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
echo ---WIRE---
grep -n 'delete process.env.AUDIT_SMOKE\|underPm2\|skipOpenAiBoot' \
  "$BASE/backend/server.js" "$BASE/backend/services/aiResponder.js" | head -20
grep -q 'ИИ снова отвечает' "$BASE/frontend/updates.js"
grep -q '## 0ld\.' "$BASE/CHANGELOG_TG.md"
echo ---PM2---
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
e=[x for x in json.load(open('/tmp/pm2j.json')) if x['name']=='tgbot'][0]['pm2_env']
n=len([x for x in (e.get('PROXY_LIST') or '').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n,'AUDIT_SMOKE':e.get('AUDIT_SMOKE')})
assert e['status']=='online' and n>=5
PY
echo ---BOOT---
grep -a '\[openai\]' /root/.pm2/logs/tgbot-out.log | tail -8 || true
echo ---ERR_RECENT---
# only lines after restart — last 30 null.chat; expect none fresh if boot ok
tail -n 80 /root/.pm2/logs/tgbot-error.log | grep -a 'Cannot read properties of null (reading .chat.)' | tail -5 || echo 'no_null_chat_in_tail'
echo AUDIT_LIVE_0ld_OK
