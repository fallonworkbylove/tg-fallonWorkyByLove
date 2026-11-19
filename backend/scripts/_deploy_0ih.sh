#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0ih}
echo "=== deploy 0ih ideas pack ==="

cp -a "$SRC/humanIdeas14.js" "$BASE/backend/services/"
cp -a "$SRC/humanHardening.js" "$BASE/backend/services/"
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/"
cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/"
cp -a "$SRC/objectionHandler.js" "$BASE/backend/services/"
cp -a "$SRC/helpRequestNotifier.js" "$BASE/backend/services/"
cp -a "$SRC/opsLiveMetrics.js" "$BASE/backend/services/"
cp -a "$SRC/proxyPools.js" "$BASE/backend/services/"
cp -a "$SRC/clientPool.js" "$BASE/backend/services/"
cp -a "$SRC/adminConsole.js" "$BASE/backend/routes/"
cp -a "$SRC/_smoke_ideas14_0ih.js" "$BASE/backend/scripts/"
cp -a "$SRC/_smoke_regress.js" "$BASE/backend/scripts/"
cp -a "$SRC/_hard_audit_0ih.js" "$BASE/backend/scripts/"
cp -a "$SRC/_scan_typo_replies.sh" "$BASE/backend/scripts/"
cp -a "$SRC/_phrase_bank_from_logs.sh" "$BASE/backend/scripts/"

[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/ops_index.html" ] && cp -a "$SRC/ops_index.html" "$BASE/ops-console/app/index.html"
[ -f "$SRC/ops_adminPanel.js" ] && cp -a "$SRC/ops_adminPanel.js" "$BASE/ops-console/app/adminPanel.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
sed -i 's/\r$//' scripts/_scan_typo_replies.sh scripts/_phrase_bank_from_logs.sh || true
node scripts/_smoke_regress.js
node scripts/_hard_audit_0ih.js

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

grep -q humanIdeas14 "$BASE/backend/services/humanHardening.js"
grep -q 'Живее ответы' "$BASE/frontend/updates.js"

pm2 restart tgbot --update-env
pm2 save
sleep 10
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
print({'status':e['status'],'PROXY':len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])})
PY
grep -oE 'updates.js\?v=[0-9]+' "$BASE/frontend/index.html" | head -1
bash scripts/_scan_typo_replies.sh | tail -5 || true
echo DEPLOY_0IH_OK
