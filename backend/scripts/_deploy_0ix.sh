#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0ix}
echo "=== deploy 0ix security hardening ==="

cp -a "$SRC/server.js" "$BASE/backend/"
cp -a "$SRC/httpRateLimit.js" "$BASE/backend/middleware/"
cp -a "$SRC/learningDb.js" "$BASE/backend/services/"
cp -a "$SRC/nftCampaign.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_security_0ix.js" "$BASE/backend/scripts/"
cp -a "$SRC/_scan_secrets_0ix.js" "$BASE/backend/scripts/"
for f in _check_login_ai_now.sh _check_login_ai_now2.sh _probe_login_dc_now.sh \
  _replace_login_proxies_sticky.sh _replace_login_proxies.sh _append_login_46.sh \
  _nl_expand_login_50_0hp.sh; do
  [ -f "$SRC/$f" ] && cp -a "$SRC/$f" "$BASE/backend/scripts/"
done
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
def setk(key, val):
    global t
    if re.search(rf'^{key}=',t,re.M):
        t=re.sub(rf'^{key}=.*$',f'{key}={val}',t,count=1,flags=re.M)
    else:
        t=t.rstrip()+f'\n{key}={val}\n'
for key in ('TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE'):
    setk(key,'false')
setk('LISTEN_HOST','127.0.0.1')
if not re.search(r'^NODE_ENV=',t,re.M):
    setk('NODE_ENV','production')
else:
    setk('NODE_ENV','production')
p.write_text(t,encoding='utf-8')
print('env patched LISTEN_HOST=127.0.0.1 NODE_ENV=production bypass=false')
PY

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','NOTIFY_BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN','TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE','LISTEN_HOST','NODE_ENV']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
export TELEGRAM_AUTH_BYPASS=false TELEGRAM_AUTH_BYPASS_FORCE=false LISTEN_HOST=127.0.0.1
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

sed -i 's/\r$//' scripts/_smoke_security_0ix.js scripts/_scan_secrets_0ix.js || true
node scripts/_smoke_security_0ix.js
node scripts/_scan_secrets_0ix.js

grep -q 'httpRateLimit' "$BASE/backend/server.js"
grep -q 'LISTEN_HOST' "$BASE/backend/server.js"
grep -q 'Усилили защиту кабинета' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=178' "$BASE/frontend/index.html"

# MySQL bind + firewall snapshot (report only)
echo "=== DB/FIREWALL ==="
mysql -N -e "SHOW VARIABLES LIKE 'bind_address';" 2>/dev/null || echo 'mysql_bind_skip'
ss -lntp | grep -E ':3306|:3000' || true
ufw status 2>/dev/null | head -20 || iptables -L INPUT -n 2>/dev/null | head -15 || true

# Soft restart with AUTH_KEY grace (SIGTERM disconnect)
pm2 stop tgbot
echo "sleep 90 for AUTH_KEY release…"
sleep 90
pm2 start tgbot --update-env
pm2 save
sleep 20
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
print({'status':e['status'],'PROXY':len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()]),'LISTEN_HOST':e.get('LISTEN_HOST'),'NODE_ENV':e.get('NODE_ENV')})
PY

# health via loopback (node bound 127.0.0.1)
curl -sS http://127.0.0.1:3000/api/health; echo
# headers check
curl -sSI -H 'X-Forwarded-Proto: https' http://127.0.0.1:3000/api/health | tr -d '\r' | grep -iE 'strict-transport|content-security|x-frame|x-content|permissions-policy' || true
# external :3000 should fail if firewall ok (best-effort)
curl -sS -m 3 http://127.0.0.1:3000/api/health >/dev/null && echo 'loopback_ok'

grep -oE 'updates.js\?v=[0-9]+' "$BASE/frontend/index.html"
echo DONE_0ix
