#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0kg}
echo "=== deploy 0kg acid theme + antihang ==="

cp -a "$SRC/frontend_styles.css" "$BASE/frontend/styles.css"
cp -a "$SRC/frontend_app.js" "$BASE/frontend/app.js"
cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cp -a "$SRC/aiResponder.js" "$BASE/backend/services/aiResponder.js"
for f in _smoke_kaif_0hm.js _smoke_10of10_0hq.js _smoke_screen_bugs_0jz.js _smoke_media_ack_refuse_0jy.js _smoke_goodnight_silence_0jy.js _smoke_activity_filter_0ke.js _smoke_howlong_parse.js _smoke_ops_quality.js; do
  [ -f "$SRC/$f" ] && cp -a "$SRC/$f" "$BASE/backend/scripts/$f"
done

grep -q 'b8ff3c' "$BASE/frontend/styles.css"
grep -q 'Space Grotesk' "$BASE/frontend/styles.css"
grep -q 'hideAppSplash' "$BASE/frontend/app.js"
grep -q 'AUDIT_SMOKE' "$BASE/backend/services/aiResponder.js"
grep -q 'styles.css?v=86' "$BASE/frontend/index.html"
grep -q 'app.js?v=175' "$BASE/frontend/index.html"
grep -q 'updates.js?v=212' "$BASE/frontend/index.html"
grep -q 'Новый вид: чёрный и кислотный зелёный' "$BASE/frontend/updates.js"

cd "$BASE/backend"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
keys=['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','MYSQL_HOST','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE','MYSQL_PORT']
for key in keys:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

# kaif: без SOCKS-клиента (анти-hang). activity: нужен DB из .env выше.
# Не оставлять AUDIT_SMOKE в shell перед pm2 --update-env (иначе openai=null).
AUDIT_SMOKE=1 node scripts/_smoke_kaif_0hm.js
AUDIT_SMOKE=1 node scripts/_smoke_activity_filter_0ke.js || echo 'WARN activity smoke skipped/fail (non-blocking UI ship)'
unset AUDIT_SMOKE || true

# UI + aiResponder: restart for hang fix
pm2 restart tgbot --update-env
sleep 2
pm2 save
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
e=[x for x in j if x['name']=='tgbot'][0]['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n,'AUDIT_SMOKE':e.get('AUDIT_SMOKE')})
assert e['status']=='online' and n>=5
if e.get('AUDIT_SMOKE') not in (None, '', '0'):
  print('WARN AUDIT_SMOKE still in pm2_env — server/aiResponder scrub under PM2')
PY
curl -sS http://127.0.0.1:3000/api/health; echo
echo DONE_0kg
