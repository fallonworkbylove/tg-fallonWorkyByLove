#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0jw}
echo "=== deploy 0jw nft after-hours stuck catchup ==="

cp -a "$SRC/nftCampaign.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_nft_unstick_0jv.js" "$BASE/backend/scripts/"
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

sed -i 's/\r$//' scripts/_smoke_nft_unstick_0jv.js || true
timeout 40 node scripts/_smoke_nft_unstick_0jv.js

grep -q 'inNftHours' "$BASE/backend/services/nftCampaign.js"
grep -q 'INTERVAL 60 MINUTE' "$BASE/backend/services/nftCampaign.js"
grep -q 'ORDER BY live_user DESC' "$BASE/backend/services/nftCampaign.js"

pm2 stop tgbot
echo "waiting 95s..."
sleep 95
pm2 start tgbot --update-env
pm2 save
sleep 12
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
assert e['status']=='online' and n>=5
PY
curl -sS http://127.0.0.1:3000/api/health; echo
echo DONE_0jw
