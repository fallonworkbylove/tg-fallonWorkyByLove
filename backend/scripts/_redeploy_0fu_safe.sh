#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -a /tmp/0fu/replyPipeline.js "$BASE/backend/services/replyPipeline.js"
cp -a /tmp/0fu/dailyLife.js "$BASE/backend/services/dailyLife.js"
cp -a /tmp/0fu/churnLearn.js "$BASE/backend/services/churnLearn.js"

cd "$BASE/backend"

ALIVE='socks5:209.127.51.109:8000:QbQaXK:LMF5Dm;socks5:23.229.75.249:8000:QbQaXK:LMF5Dm;socks5:154.30.136.63:8000:QbQaXK:LMF5Dm;socks5:173.209.232.164:8000:QbQaXK:LMF5Dm;socks5:173.209.233.42:8000:QbQaXK:LMF5Dm;socks5:168.81.66.214:8000:nFBMNd:QEntaw;socks5:72.56.182.199:8000:QbQaXK:LMF5Dm;socks5:72.56.184.168:8000:QbQaXK:LMF5Dm;socks5:72.56.181.78:8000:QbQaXK:LMF5Dm'

# Force PROXY_LIST in .env
python3 - <<PY
from pathlib import Path
import re
alive = '''$ALIVE'''
p = Path('.env')
text = p.read_text(encoding='utf-8', errors='replace')
if re.search(r'^PROXY_LIST=', text, re.M):
    text = re.sub(r'^PROXY_LIST=.*$', 'PROXY_LIST=' + alive, text, count=1, flags=re.M)
else:
    text = text.rstrip() + '\nPROXY_LIST=' + alive + '\n'
p.write_text(text, encoding='utf-8')
print('dotenv_proxy_ok', alive.count('socks5:'))
PY

# Export keys for pm2 --update-env
eval "$(python3 - <<'PY'
import re
from pathlib import Path
text = Path('.env').read_text(encoding='utf-8', errors='ignore')
keys = [
  'OPENAI_API_KEY', 'ADMIN_CONSOLE_TOKEN', 'PROXY_LIST', 'PROXY_LIST_LOGIN',
  'PROXY_FILE', 'PROXY_FILE_LOGIN', 'BOT_TOKEN', 'PORT',
]
for key in keys:
    m = re.search(rf'^{re.escape(key)}=(.*)$', text, re.M)
    if not m:
        continue
    val = m.group(1).strip()
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        val = val[1:-1]
    safe = val.replace("'", "'\"'\"'")
    print(f"export {key}='{safe}'")
PY
)"

echo "shell_PROXY_LEN=$(echo "$PROXY_LIST" | tr ';' '\n' | grep -c socks5 || true)"
if [ "$(echo "$PROXY_LIST" | tr ';' '\n' | grep -c socks5 || true)" -lt 5 ]; then
  echo 'REFUSING empty PROXY_LIST'
  exit 1
fi

timeout 90 pm2 restart tgbot --update-env
pm2 save
sleep 10

node -e '
const {execSync}=require("child_process");
const j=JSON.parse(execSync("pm2 jlist",{encoding:"utf8"}));
const p=j.find(x=>x.name==="tgbot");
const pl=(p&&p.pm2_env&&p.pm2_env.PROXY_LIST)||"";
console.log(JSON.stringify({
  status:p.pm2_env.status,
  proxy_len:pl.split(";").filter(Boolean).length,
  has_dead:/168\\.80\\.83\\.53|185\\.168\\.250/.test(pl),
}));
'
grep "Work (DC) пул" /root/.pm2/logs/tgbot-out.log | tail -1

python3 - <<'PY'
from pathlib import Path
err=Path('/root/.pm2/logs/tgbot-error.log').read_text(encoding='utf-8',errors='replace').splitlines()
idxs=[i for i,l in enumerate(err) if 'setMyCommands' in l]
tail=err[idxs[-1]:] if idxs else []
print('issues_after_restart:')
hit=False
for ln in tail:
    if any(x in ln for x in ['is not defined','churnLearn schema','churnLearn] ensure']):
        print(ln[:220]); hit=True
if not hit:
    print('(none)')
PY
echo REDEPLOY_SAFE_OK
