#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0it}
echo "=== deploy 0it pitch pause + circle concert ==="

mkdir -p "$BASE/backend/media" "$BASE/backend/scripts" "$BASE/frontend" "$BASE/ops-console/app"
cp -a "$SRC/nftCampaign.js" "$BASE/backend/services/"
cp -a "$SRC/helpRequestNotifier.js" "$BASE/backend/services/"
cp -a "$SRC/aiResponder.js" "$BASE/backend/services/"
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/"
cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/"
cp -a "$SRC/own_media_desc.json" "$BASE/backend/media/"
cp -a "$SRC/_smoke_pitch_circle_0it.js" "$BASE/backend/scripts/"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
python3 - <<'PY'
import re
from pathlib import Path
p=Path('.env'); t=p.read_text(encoding='utf-8',errors='replace')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
n=len([x for x in (m.group(1).strip() if m else '').split(';') if x.strip()])
print('env_PROXY_LEN', n)
if n < 5: raise SystemExit('REFUSE_PROXY env')
for key in ('TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE'):
    if re.search(rf'^{key}=',t,re.M):
        t=re.sub(rf'^{key}=.*$',f'{key}=false',t,count=1,flags=re.M)
    else:
        t=t.rstrip()+f'\n{key}=false\n'
p.write_text(t,encoding='utf-8')
PY
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','NOTIFY_BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN','TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
export TELEGRAM_AUTH_BYPASS=false TELEGRAM_AUTH_BYPASS_FORCE=false
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

sed -i 's/\r$//' scripts/_smoke_pitch_circle_0it.js || true
node scripts/_smoke_pitch_circle_0it.js

grep -q nft_pending "$BASE/backend/services/nftCampaign.js"
grep -q 'концерт' "$BASE/backend/media/own_media_desc.json"
grep -q fixCirclePlaceMismatch "$BASE/backend/services/softHumanLite.js"
grep -q 'После предложки больше не болтает' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=174' "$BASE/frontend/index.html"

pm2 restart tgbot --update-env
pm2 save
sleep 12
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
print({'status':e['status'],'PROXY':len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])})
PY
grep -oE 'updates.js\?v=[0-9]+' "$BASE/frontend/index.html"
echo DONE_0it
