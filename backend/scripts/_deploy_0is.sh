#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0is}
echo "=== deploy 0is lag cap ==="

cp -a "$SRC/scaleOps.js" "$BASE/backend/services/"
cp -a "$SRC/opsQuality.js" "$BASE/backend/services/"
cp -a "$SRC/inbound.js" "$BASE/backend/services/"
cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_lag_cap_0is.js" "$BASE/backend/scripts/"
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

# нормализуем 8/8 → 4/7 (ощущение ~человеческих 5–12с с typing, без стека до 40с)
python3 - <<'PY'
import re, subprocess
from pathlib import Path
t=Path('.env').read_text(errors='replace')
def g(k):
 m=re.search(rf'^{re.escape(k)}=(.*)$',t,re.M)
 return m.group(1).strip() if m else ''
host,user,pw,db,port=g('DB_HOST'),g('DB_USER'),g('DB_PASSWORD'),g('DB_NAME'),g('DB_PORT') or '3306'
sql=("UPDATE accounts SET reply_delay_min=4, reply_delay_max=7 "
     "WHERE is_autoreply_enabled=1 AND reply_delay_min>=8 AND reply_delay_max<=8;")
sql2=("UPDATE accounts SET reply_delay_min=4, reply_delay_max=10 "
      "WHERE is_autoreply_enabled=1 AND reply_delay_min>=20;")
for s in (sql, sql2):
  subprocess.check_call(['mysql','-h',host,'-P',port,'-u',user,f'-p{pw}',db,'-e',s], stderr=subprocess.DEVNULL)
out=subprocess.check_output(
  ['mysql','-h',host,'-P',port,'-u',user,f'-p{pw}',db,'-N','-e',
   'SELECT id,phone,reply_delay_min,reply_delay_max FROM accounts WHERE is_autoreply_enabled=1 ORDER BY id'],
  text=True, stderr=subprocess.DEVNULL)
print('delays_after')
print(out)
PY

sed -i 's/\r$//' scripts/_smoke_lag_cap_0is.js || true
node scripts/_smoke_lag_cap_0is.js

grep -q 'Math.min(textDelayMs, 14_000)' "$BASE/backend/services/replyPipeline.js"
grep -q 'delayMult: 1.15' "$BASE/backend/services/opsQuality.js"
grep -q 'MIN_REPLY_GAP_MS = 7000' "$BASE/backend/services/inbound.js"
grep -q 'Боты быстрее отвечают' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=173' "$BASE/frontend/index.html"

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
echo DONE_0is
