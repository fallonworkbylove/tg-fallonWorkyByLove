#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0jm}
echo "=== deploy 0jm hard-opt ==="

cp -a "$SRC/db.js" "$BASE/backend/"
for f in mediaReplies.js mediaSend.js silenceCatchup.js opsQuality.js nftCampaign.js; do
  [ -f "$SRC/$f" ] && cp -a "$SRC/$f" "$BASE/backend/services/"
done
cp -a "$SRC/_smoke_opt_0jm.js" "$BASE/backend/scripts/"
cp -a "$SRC/_hard_audit_0jm.js" "$BASE/backend/scripts/"
cp -a "$SRC/_audit_c_0jm.sh" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_ultra_hard_audit.js" "$BASE/backend/scripts/" 2>/dev/null || true

[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && mkdir -p "$BASE/ops-console/app" && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','DB_POOL_LIMIT']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

sed -i 's/\r$//' scripts/_smoke_opt_0jm.js scripts/_hard_audit_0jm.js || true
timeout 40 node scripts/_smoke_opt_0jm.js
timeout 40 node scripts/_hard_audit_0jm.js

grep -q 'enableKeepAlive' "$BASE/backend/db.js"
grep -q 'captionsCache' "$BASE/backend/services/mediaReplies.js"
grep -q 'flushTimer' "$BASE/backend/services/opsQuality.js"
grep -q 'OFFSET 5' "$BASE/backend/services/nftCampaign.js"
grep -q 'pruneHealedRecently' "$BASE/backend/services/silenceCatchup.js"
grep -q 'Меньше нагрузки на базу' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=193' "$BASE/frontend/index.html"

pm2 stop tgbot
echo "waiting 95s..."
sleep 95
pm2 start tgbot --update-env
pm2 save
sleep 15
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
if e['status']!='online': raise SystemExit('tgbot not online')
if n < 5: raise SystemExit('REFUSE_PROXY pm2')
PY
curl -sS http://127.0.0.1:3000/api/health; echo
# kick silence heal once
timeout 60 node -e "require('./services/silenceCatchup').runSilenceCatchupHeal({limit:8}).then(r=>console.log('heal',r)).catch(e=>console.error(e))" || true
echo DONE_0jm
