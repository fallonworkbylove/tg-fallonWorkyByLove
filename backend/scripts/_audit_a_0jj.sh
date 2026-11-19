#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
timeout 25 node scripts/_smoke_nft_live_0jj.js
grep -q 'NFT_VOICE_LIVE_DIALOG_MIN = 120' services/nftCampaign.js && echo WIRE_120_OK
grep -q 'updates.js?v=190' ../frontend/index.html && echo V190_OK
grep -q 'NFT-голосовое шире' ../frontend/updates.js && echo TITLE_OK
curl -sS http://127.0.0.1:3000/api/health; echo
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
assert e['status']=='online' and n>=5
print('AUDIT_A_0JJ_OK')
PY
