#!/bin/bash
# Probe NEW26, write notebooks, merge TG_OK into PROXY_LIST, restart pm2.
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$B"

echo "=== probe NEW26 ==="
OUT_DIR="$B/config" node scripts/_probe_new26_classify.js | tee /tmp/new26_probe.out

TG_FILE="$B/config/proxies-tg-ok.txt"
OA_FILE="$B/config/proxies-openai-ok.txt"
DEAD_FILE="$B/config/proxies-dead.txt"

echo "=== notebooks ==="
echo "TG:     $(grep -cE '^[0-9]' "$TG_FILE" 2>/dev/null || echo 0)"
echo "OPENAI: $(grep -cE '^[0-9]' "$OA_FILE" 2>/dev/null || echo 0)"
echo "DEAD:   $(grep -cE '^[0-9]' "$DEAD_FILE" 2>/dev/null || echo 0)"

# Build socks5 list from NEW tg-ok only (hosts from probe output)
mapfile -t NEW_TG < <(awk '/^TG_LINES$/{f=1;next} /^OPENAI_LINES$/{f=0} f && NF{print}' /tmp/new26_probe.out)
echo "NEW_TG_COUNT=${#NEW_TG[@]}"

python3 - <<'PY'
import re
from pathlib import Path

b = Path('/root/opt/tgbot/tg-miniapp-loverussian/backend')
out = Path('/tmp/new26_probe.out').read_text(encoding='utf-8', errors='ignore')
lines = out.splitlines()
tg = []
mode = None
for ln in lines:
    if ln == 'TG_LINES':
        mode = 'tg'
        continue
    if ln in ('OPENAI_LINES', 'DEAD_LINES', '---'):
        if ln != 'TG_LINES':
            mode = None if ln.startswith('---') else None
        if ln == 'OPENAI_LINES':
            mode = None
        if ln == 'DEAD_LINES':
            mode = None
        continue
    if mode == 'tg' and ln.strip() and not ln.startswith('NEW_') and not ln.startswith('NOTEBOOK'):
        # host:port:user:pass
        parts = ln.strip().split(':')
        if len(parts) >= 4 and parts[0][0].isdigit():
            tg.append(ln.strip())

# re-parse more carefully
tg = []
mode = None
for ln in lines:
    if ln.strip() == 'TG_LINES':
        mode = 'tg'
        continue
    if ln.strip() in ('OPENAI_LINES', 'DEAD_LINES'):
        mode = None
        continue
    if mode == 'tg':
        parts = ln.strip().split(':')
        if len(parts) == 4:
            tg.append(ln.strip())

print('parsed_new_tg', len(tg))
for x in tg:
    print('ADD', x)

env_path = b / '.env'
text = env_path.read_text(encoding='utf-8', errors='ignore')
m = re.search(r'^PROXY_LIST=(.*)$', text, re.M)
cur = (m.group(1).strip() if m else '')
existing = [x.strip() for x in cur.split(';') if x.strip()]
exist_hosts = set()
for e in existing:
    p = e.split(':')
    if p[0] == 'socks5' and len(p) >= 2:
        exist_hosts.add(p[1])
    elif p:
        exist_hosts.add(p[0])

added = []
for line in tg:
    host, port, user, pw = line.split(':')
    if host in exist_hosts:
        continue
    added.append(f'socks5:{host}:{port}:{user}:{pw}')
    exist_hosts.add(host)

new_list = existing + added
alive = ';'.join(new_list)
if m:
    text2 = re.sub(r'^PROXY_LIST=.*$', 'PROXY_LIST=' + alive, text, count=1, flags=re.M)
else:
    text2 = text.rstrip() + '\nPROXY_LIST=' + alive + '\n'
env_path.write_text(text2, encoding='utf-8')
Path('/tmp/new26_PROXY_LIST.txt').write_text(alive, encoding='utf-8')
print('ADDED', len(added))
print('PROXY_LEN', len(new_list))
PY

export PROXY_LIST="$(cat /tmp/new26_PROXY_LIST.txt)"
n=$(echo "$PROXY_LIST" | tr ';' '\n' | grep -c socks5 || true)
echo "PROXY_LEN=$n"
if [ "$n" -lt 5 ]; then
  echo "REFUSE: PROXY_LEN < 5"
  exit 1
fi

# keep proxies.txt empty (env-only)
printf '%s\n' '# work proxies live in PROXY_LIST only' > "$B/config/proxies.txt"

# also export OPENAI_PROXY_LIST from openai notebook (optional, if key exists)
python3 - <<'PY'
import re
from pathlib import Path
b = Path('/root/opt/tgbot/tg-miniapp-loverussian/backend')
oa = b / 'config' / 'proxies-openai-ok.txt'
lines = []
if oa.exists():
    for ln in oa.read_text(encoding='utf-8', errors='ignore').splitlines():
        ln = ln.strip()
        if not ln or ln.startswith('#'):
            continue
        parts = ln.split(':')
        if len(parts) == 4:
            lines.append(f'socks5:{parts[0]}:{parts[1]}:{parts[2]}:{parts[3]}')
alive = ';'.join(lines)
env = b / '.env'
text = env.read_text(encoding='utf-8', errors='ignore')
if re.search(r'^OPENAI_PROXY_LIST=', text, re.M):
    text2 = re.sub(r'^OPENAI_PROXY_LIST=.*$', 'OPENAI_PROXY_LIST=' + alive, text, count=1, flags=re.M)
else:
    text2 = text.rstrip() + '\nOPENAI_PROXY_LIST=' + alive + '\n'
env.write_text(text2, encoding='utf-8')
print('OPENAI_PROXY_LEN', len(lines))
Path('/tmp/new26_OPENAI_PROXY_LIST.txt').write_text(alive, encoding='utf-8')
PY

export OPENAI_PROXY_LIST="$(cat /tmp/new26_OPENAI_PROXY_LIST.txt 2>/dev/null || true)"

set -a
# shellcheck disable=SC1091
source <(python3 - <<'PY'
from pathlib import Path
import shlex, re
t = Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/.env').read_text(encoding='utf-8', errors='ignore')
for key in ['OPENAI_API_KEY','ADMIN_CONSOLE_TOKEN','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','ADMIN_ALERT_CHAT_ID','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME']:
    m = re.search(rf'^{key}=(.*)$', t, re.M)
    if m:
        print(f'export {key}={shlex.quote(m.group(1).strip())}')
PY
)
set +a

pm2 restart tgbot --update-env
pm2 save
sleep 2
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; oa=p["pm2_env"].get("OPENAI_PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()]),"pm2_OPENAI_LEN":len([x for x in oa.split(";") if x.strip()]),"restarts":p["pm2_env"].get("restart_time")})'
echo DONE
