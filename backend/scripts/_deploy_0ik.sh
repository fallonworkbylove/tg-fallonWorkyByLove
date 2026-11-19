#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0ik}
echo "=== deploy 0ik blue-violet theme + unslop ==="

mkdir -p "$BASE/prompts"
[ -f "$SRC/persona_slim.txt" ] && cp -a "$SRC/persona_slim.txt" "$BASE/prompts/"
[ -f "$SRC/frontend_styles.css" ] && cp -a "$SRC/frontend_styles.css" "$BASE/frontend/styles.css"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

grep -q '8b7cf6' "$BASE/frontend/styles.css"
grep -q 'Кабинет сине-фиолетовый' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=165' "$BASE/frontend/index.html"
grep -q 'styles.css?v=73' "$BASE/frontend/index.html"
grep -q 'Ты {{NAME}}' "$BASE/prompts/persona_slim.txt"
! grep -q 'Обычная живая' "$BASE/prompts/persona_slim.txt"
! grep -qE '—|–' "$BASE/prompts/persona_slim.txt" || { echo 'FAIL emdash in slim'; exit 1; }

cd "$BASE/backend"
python3 - <<'PY'
import re
from pathlib import Path
p=Path('.env'); t=p.read_text(encoding='utf-8',errors='replace')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
n=len([x for x in (m.group(1).strip() if m else '').split(';') if x.strip()])
print('env_PROXY_LEN', n)
if n < 5: raise SystemExit('REFUSE_PROXY env')
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

# persona_slim reload needs process restart
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
node -e "const t=require('./services/scaleOps').PERSONA_TEMPLATES.find(x=>x.id==='vika_timashevsk'); const p=(t&&t.prompt)||''; console.log(p.split('\\n').slice(0,2).join(' | ')); if(/Обычная живая|—|живёшь в Липецк[,\\s]/.test(p)) process.exit(2);"
echo DONE_0ik
