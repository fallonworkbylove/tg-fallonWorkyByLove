#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0kz}
echo "=== deploy 0kz audit P0-P2 fixes ==="

cp -a "$SRC/objectionHandler.js" "$BASE/backend/services/objectionHandler.js"
cp -a "$SRC/avatarMatch.js" "$BASE/backend/services/avatarMatch.js"
cp -a "$SRC/howLong.js" "$BASE/backend/services/howLong.js"
cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/replyPipeline.js"
cp -a "$SRC/nftCampaign.js" "$BASE/backend/services/nftCampaign.js"
cp -a "$SRC/opsLiveMetrics.js" "$BASE/backend/services/opsLiveMetrics.js"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cp -a "$SRC/_smoke_audit_p0p2_0kz.js" "$BASE/backend/scripts/_smoke_audit_p0p2_0kz.js"

grep -q 'updates.js?v=231' "$BASE/frontend/index.html"
grep -q 'Чиним ответы на фото и сроки' "$BASE/frontend/updates.js"
grep -q 'voice_skip_reason' "$BASE/backend/services/nftCampaign.js"
grep -q 'extractClaimProbeText\|userClaimsHerPhoto' "$BASE/backend/services/objectionHandler.js"
grep -q 'matchesOwnAvatar' "$BASE/backend/services/replyPipeline.js"
grep -q 'ответил (reengage), сколько на дв' "$BASE/backend/services/replyPipeline.js"

cd "$BASE/backend"
node scripts/_smoke_audit_p0p2_0kz.js
node scripts/_smoke_avatar_claim_0ky.js

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',text,re.M)
if m: print('export PROXY_LIST=%s'%shlex.quote(m.group(1).strip()))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

pm2 restart tgbot --update-env
pm2 save
sleep 2
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
e=[x for x in j if x['name']=='tgbot'][0]['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
assert e['status']=='online' and n>=5
PY
curl -sS http://127.0.0.1:3000/api/health; echo
echo DONE_0kz
