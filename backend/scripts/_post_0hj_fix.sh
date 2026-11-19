#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

# Ensure bypass false in .env + pm2
python3 - <<'PY'
import re
from pathlib import Path
p = Path('.env')
t = p.read_text(encoding='utf-8', errors='ignore')
for key in ('TELEGRAM_AUTH_BYPASS', 'TELEGRAM_AUTH_BYPASS_FORCE'):
    if re.search(rf'^{key}=', t, re.M):
        t = re.sub(rf'^{key}=.*$', f'{key}=false', t, count=1, flags=re.M)
    else:
        t = t.rstrip() + f'\n{key}=false\n'
p.write_text(t, encoding='utf-8')
print('env bypass false')
PY

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN','TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
export TELEGRAM_AUTH_BYPASS=false
export TELEGRAM_AUTH_BYPASS_FORCE=false

pm2 restart tgbot --update-env
pm2 save
sleep 12
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]),"BYPASS":e.get("TELEGRAM_AUTH_BYPASS"),"FORCE":e.get("TELEGRAM_AUTH_BYPASS_FORCE")})'

echo "wait heal scheduler ~100s..."
sleep 100

echo "===== media soft / heal logs ====="
grep -aE 'silence-heal|silenceCatchup|mediaSoft|entity' /root/.pm2/logs/tgbot-out.log | tail -30
grep -aE 'silence-heal|silenceCatchup' /root/.pm2/logs/tgbot-error.log | tail -15

echo "===== gaps now ====="
node scripts/_audit_heal_0hj.js 2>/dev/null | tail -35 || true
node - <<'NODE'
require('dotenv').config();
const { findUnfulfilledMediaGaps, findDbSilenceGaps } = require('./services/silenceCatchup');
(async () => {
  const soft = await findUnfulfilledMediaGaps({ maxAgeHours: 12, limit: 10 });
  const gaps = await findDbSilenceGaps({ maxAgeHours: 12, minAgeMin: 3, limit: 10 });
  console.log('soft_media', soft.length, soft.map(r => ({a:r.account_id,p:r.peer_id,u:r.last_user_text,b:r.last_bot_text})));
  console.log('hard_gaps', gaps.length, gaps.map(r => ({a:r.account_id,p:r.peer_id,u:r.last_user_text})));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
NODE

echo "===== Warm TG ====="
grep -a 'Warm TG:' /root/.pm2/logs/tgbot-out.log | tail -8

echo "===== nightly ====="
OPENAI_API_KEY=sk-test node scripts/_nightly_hard_audit.js 2>&1 | tail -8

echo POST_0HJ_DONE
