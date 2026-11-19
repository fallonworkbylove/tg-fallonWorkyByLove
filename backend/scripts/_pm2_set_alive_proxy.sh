#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
ALIVE='socks5:209.127.51.109:8000:QbQaXK:LMF5Dm;socks5:23.229.75.249:8000:QbQaXK:LMF5Dm;socks5:154.30.136.63:8000:QbQaXK:LMF5Dm;socks5:173.209.232.164:8000:QbQaXK:LMF5Dm;socks5:173.209.233.42:8000:QbQaXK:LMF5Dm;socks5:168.81.66.214:8000:nFBMNd:QEntaw;socks5:72.56.182.199:8000:QbQaXK:LMF5Dm;socks5:72.56.184.168:8000:QbQaXK:LMF5Dm;socks5:72.56.181.78:8000:QbQaXK:LMF5Dm'

# Ensure .env
python3 - <<PY
from pathlib import Path
import re
p = Path('.env')
text = p.read_text(encoding='utf-8', errors='replace')
alive = '''$ALIVE'''
text2 = re.sub(r'^PROXY_LIST=.*$', 'PROXY_LIST=' + alive, text, count=1, flags=re.M)
if text2 == text and 'PROXY_LIST=' not in text:
    text2 = text.rstrip() + '\nPROXY_LIST=' + alive + '\n'
p.write_text(text2, encoding='utf-8')
print('dotenv_ok', '168.80.83.53' not in Path('.env').read_text())
PY

{
  echo '# alive only'
  echo "$ALIVE" | tr ';' '\n'
} > config/proxies.txt

# Force into PM2 process env (dotenv won't override existing PM2 vars)
pm2 restart tgbot --update-env --
# delete and resurrect with env from dump is heavy — use pm2 set / ecosystem
# Simplest: pm2 restart with env injection
pm2 delete tgbot >/dev/null 2>&1 || true
# Find how it was started
if [ -f ecosystem.config.cjs ]; then
  # patch ecosystem if PROXY_LIST there
  if grep -q PROXY_LIST ecosystem.config.cjs 2>/dev/null; then
    python3 - <<'PY'
from pathlib import Path
import re
alive = open('/tmp/alive_proxy.txt').read().strip() if False else None
PY
  fi
fi

# Start via dotenvx/node with clean env from .env only for PROXY_LIST
# Use pm2 start with --env and explicit env
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
pm2 start server.js --name tgbot --cwd /root/opt/tgbot/tg-miniapp-loverussian/backend \
  --update-env \
  --env production

# Inject PROXY_LIST into running process env via pm2
pm2 restart tgbot --update-env
# Explicitly set in dump
node -e "
const {execSync}=require('child_process');
const alive=process.env.ALIVE||'';
" 

# Use pm2 env set if available
pm2 set tgbot:PROXY_LIST "$ALIVE" 2>/dev/null || true

# Most reliable: export in a wrapper start
cat > /tmp/start_tgbot_alive.sh <<EOF
#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
export PROXY_LIST='$ALIVE'
# strip dead from inherited
exec node -r dotenv/config server.js
EOF
# Actually dotenv won't override export — good, our export wins if we set before dotenv... 
# dotenv default does NOT override existing. So export PROXY_LIST first then dotenv loads rest.

pm2 delete tgbot
pm2 start /tmp/start_tgbot_alive.sh --name tgbot --interpreter bash
sleep 6
pm2 save
pm2 describe tgbot | head -10
# verify pool size in log
sleep 4
grep 'Work (DC) пул' /root/.pm2/logs/tgbot-out.log | tail -1
