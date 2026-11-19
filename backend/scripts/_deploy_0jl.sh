#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0jl}
echo "=== deploy 0jl core opt ==="

cp -a "$SRC/db.js" "$BASE/backend/"
for f in voiceReplies.js nftCampaign.js humanIdeasRegistry.js humanHardening.js \
  aiResponderPostprocess.js softHumanLite.js aiResponder.js replyPipeline.js \
  replySendPrep.js opsEvents.js opsQuality.js clientPool.js aiResponder.vps-oct1.js; do
  [ -f "$SRC/$f" ] && cp -a "$SRC/$f" "$BASE/backend/services/"
done
cp -a "$SRC/_smoke_opt_0jl.js" "$BASE/backend/scripts/"
cp -a "$SRC/_smoke_voprosy_dup_0jk.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_smoke_ops_quality.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_smoke_kaif_0hm.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_smoke_human_v2.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_smoke_runner.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_hard_audit_0jl.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_audit_c_0jl.sh" "$BASE/backend/scripts/" 2>/dev/null || true

# cleanup bak/archived on VPS
rm -f "$BASE/backend/services/aiResponder.js.bak-"* \
  "$BASE/backend/services/aiResponder.vps-oct1.js.archived" 2>/dev/null || true

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

sed -i 's/\r$//' scripts/_smoke_opt_0jl.js scripts/_smoke_voprosy_dup_0jk.js || true
timeout 50 node scripts/_smoke_opt_0jl.js
timeout 40 node scripts/_smoke_voprosy_dup_0jk.js

grep -q 'NFT_TICK_MIN_MS' "$BASE/backend/services/nftCampaign.js"
grep -q 'triggersCache' "$BASE/backend/services/voiceReplies.js"
grep -q 'DB_POOL_LIMIT' "$BASE/backend/db.js"
grep -q 'Быстрее и стабильнее внутри' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=192' "$BASE/frontend/index.html"

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
echo DONE_0jl
