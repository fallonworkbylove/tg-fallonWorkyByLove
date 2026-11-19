#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0ld}
echo "=== deploy 0ld openai null.chat ==="

cp -a "$SRC/aiResponder.js" "$BASE/backend/services/aiResponder.js"
cp -a "$SRC/server.js" "$BASE/backend/server.js"
cp -a "$SRC/mediaReplies.js" "$BASE/backend/services/mediaReplies.js"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cp -a "$SRC/_smoke_openai_null_0ld.js" "$BASE/backend/scripts/_smoke_openai_null_0ld.js"

grep -q 'delete process.env.AUDIT_SMOKE' "$BASE/backend/server.js"
grep -q 'underPm2' "$BASE/backend/services/aiResponder.js"
grep -q 'checked?.chat' "$BASE/backend/services/mediaReplies.js"
grep -q 'updates.js?v=235' "$BASE/frontend/index.html"
grep -q 'ИИ снова отвечает' "$BASE/frontend/updates.js"
grep -q '## 0ld\.' "$BASE/CHANGELOG_TG.md"

cd "$BASE/backend"
# Smoke без export в shell — только inline env.
AUDIT_SMOKE=1 node scripts/_smoke_openai_null_0ld.js
unset AUDIT_SMOKE || true

# Вычистить залипший AUDIT_SMOKE из dump до restart.
python3 - <<'PY'
import json
from pathlib import Path
p=Path('/root/.pm2/dump.pm2')
if not p.exists():
  print('no dump')
  raise SystemExit(0)
data=json.loads(p.read_text())
n=0
for app in data:
  for key in ('pm2_env','env'):
    env=app.get(key)
    if isinstance(env, dict) and 'AUDIT_SMOKE' in env:
      del env['AUDIT_SMOKE']
      n+=1
p.write_text(json.dumps(data))
print('scrubbed_AUDIT_SMOKE', n)
PY

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

# Рестарт без AUDIT_SMOKE в shell; код под PM2 тоже игнорирует флаг.
unset AUDIT_SMOKE || true
pm2 restart tgbot --update-env
pm2 save
# Повторный scrub dump после save (pm2 мог снова записать var).
python3 - <<'PY'
import json
from pathlib import Path
p=Path('/root/.pm2/dump.pm2')
data=json.loads(p.read_text())
n=0
for app in data:
  for key in ('pm2_env','env'):
    env=app.get(key)
    if isinstance(env, dict) and env.get('AUDIT_SMOKE'):
      del env['AUDIT_SMOKE']
      n+=1
p.write_text(json.dumps(data))
print('post_save_scrub', n)
PY
sleep 3
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
e=[x for x in j if x['name']=='tgbot'][0]['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n,'AUDIT_SMOKE':e.get('AUDIT_SMOKE')})
assert e['status']=='online' and n>=5
PY
curl -sS http://127.0.0.1:3000/api/health; echo
sleep 2
grep -aE '\[openai\] Запросы идут|Cannot read properties of null \(reading .chat.\)' /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -20 || true
echo DONE_0ld
