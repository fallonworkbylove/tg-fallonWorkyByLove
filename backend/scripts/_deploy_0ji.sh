#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0ji}
echo "=== deploy 0ji bundle ==="

cp -a "$SRC/humanIdeasRegistry.js" "$BASE/backend/services/"
cp -a "$SRC/aiResponderPostprocess.js" "$BASE/backend/services/"
cp -a "$SRC/replyPipelineShared.js" "$BASE/backend/services/"
cp -a "$SRC/humanHardening.js" "$BASE/backend/services/"
cp -a "$SRC/aiResponder.js" "$BASE/backend/services/"
cp -a "$SRC/aiResponder.vps-oct1.js" "$BASE/backend/services/"
cp -a "$SRC/aiResponder.vps-oct1.js.archived" "$BASE/backend/services/" 2>/dev/null || true
cp -a "$SRC/nftCampaign.js" "$BASE/backend/services/"
cp -a "$SRC/silenceCatchup.js" "$BASE/backend/services/"
cp -a "$SRC/opsLiveMetrics.js" "$BASE/backend/services/"
cp -a "$SRC/opsQuality.js" "$BASE/backend/services/"
cp -a "$SRC/clientPool.js" "$BASE/backend/services/"
cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/"
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/"
cp -a "$SRC/server.js" "$BASE/backend/"
cp -a "$SRC/_diag_nft_now.js" "$BASE/backend/scripts/"
cp -a "$SRC/_smoke_runner.js" "$BASE/backend/scripts/"
cp -a "$SRC/_smoke_bundle_0ji.js" "$BASE/backend/scripts/"
cp -a "$SRC/_deploy_template.sh" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_hard_audit_0ji.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_audit_c_0ji.sh" "$BASE/backend/scripts/" 2>/dev/null || true

[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && mkdir -p "$BASE/ops-console/app" && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

# CORS * → empty in .env (не ломаем, только правим звёздочку)
python3 - <<'PY'
from pathlib import Path
p=Path('.env')
t=p.read_text(encoding='utf-8',errors='ignore')
import re
nt=re.sub(r'^CORS_ORIGIN=\*$', 'CORS_ORIGIN=', t, flags=re.M)
if nt!=t:
    p.write_text(nt, encoding='utf-8')
    print('CORS_STAR_CLEARED')
else:
    print('CORS_OK')
PY

sed -i 's/\r$//' scripts/_smoke_bundle_0ji.js scripts/_smoke_runner.js || true
timeout 60 node scripts/_smoke_bundle_0ji.js

grep -q 'humanIdeasRegistry' "$BASE/backend/services/humanHardening.js"
grep -q 'loadArchiveFlagsSafe' "$BASE/backend/services/nftCampaign.js"
grep -q 'NFT воронка и живые ответы' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=189' "$BASE/frontend/index.html"

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
grep -oE 'updates.js\?v=[0-9]+' "$BASE/frontend/index.html"
echo DONE_0ji
