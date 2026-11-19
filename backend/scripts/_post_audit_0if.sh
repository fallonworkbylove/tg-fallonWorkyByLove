#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
! grep -q trashPeerFilter "$BASE/backend/services/replyPipeline.js"
! grep -q "мусор/i.test(finalNote)" "$BASE/backend/services/leadScoring.js"
grep -q 'Отсев мусора отключён' "$BASE/frontend/updates.js"
cd "$BASE/backend" && node scripts/_smoke_no_trash_0if.js
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
assert e['status']=='online'
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
assert n>=5, n
print({'status':e['status'],'PROXY':n})
PY
grep -oE 'updates.js\?v=160' "$BASE/frontend/index.html"
echo POST_AUDIT_0IF_OK
