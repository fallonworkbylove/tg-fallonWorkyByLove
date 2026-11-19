#!/bin/bash
set -euo pipefail
echo ---WIRE---
grep -n maybeAppendHeardAskOnWorkTalk \
  /root/opt/tgbot/tg-miniapp-loverussian/backend/services/aiResponder.js \
  /root/opt/tgbot/tg-miniapp-loverussian/backend/services/jobFlipAsk.js
echo ---PROXY---
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
e=[x for x in json.load(open('/tmp/pm2j.json')) if x['name']=='tgbot'][0]['pm2_env']
n=len([x for x in (e.get('PROXY_LIST') or '').split(';') if x.strip()])
print({'status': e['status'], 'PROXY': n})
assert e['status']=='online' and n>=5
PY
echo ---OUT---
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound ' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -20 || true
echo ---ERR---
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -15 || true
echo AUDIT_LIVE_0lb_OK
