#!/bin/bash
# Keep PROXY_LIST = TG_OK only; openai-only → OPENAI_PROXY_LIST + notebooks; dead → dead notebook.
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$B"
PROBE=${1:-/tmp/pool32_probe.out}
if [ ! -f "$PROBE" ]; then
  echo "missing probe file $PROBE"
  exit 1
fi

python3 - <<'PY'
import json, re, shlex
from pathlib import Path
from subprocess import check_output
from datetime import datetime, timezone

b = Path('/root/opt/tgbot/tg-miniapp-loverussian/backend')
probe = Path('/tmp/pool32_probe.out').read_text(encoding='utf-8', errors='ignore')

# current PROXY_LIST from pm2 (full creds)
j = json.loads(check_output(['pm2', 'jlist'], text=True))
p = [x for x in j if x['name'] == 'tgbot'][0]
pl = p['pm2_env'].get('PROXY_LIST') or ''
by_host = {}
for e in pl.split(';'):
    e = e.strip()
    if not e:
        continue
    parts = e.split(':')
    if parts[0].lower() != 'socks5' or len(parts) < 5:
        continue
    host = parts[1]
    by_host[host] = e  # socks5:host:port:user:pass

# classify from probe
kind = {}
for ln in probe.splitlines():
    ln = ln.strip()
    if not ln.startswith(('TG_OK', 'TG_FAIL_BUT_ALIVE', 'DEAD')):
        continue
    # TG_OK host:port tg=...
    bits = ln.split()
    if len(bits) < 2:
        continue
    k = bits[0]
    hp = bits[1]
    host = hp.split(':')[0]
    if host[0].isdigit():
        kind[host] = k

tg, oa, dead = [], [], []
unknown = []
for host, entry in by_host.items():
    k = kind.get(host)
    # line without socks5: for notebooks host:port:user:pass
    parts = entry.split(':')
    note = f"{parts[1]}:{parts[2]}:{parts[3]}:{parts[4]}"
    if k == 'TG_OK':
        tg.append(entry)
    elif k == 'TG_FAIL_BUT_ALIVE':
        oa.append(entry)
        # also keep notebook format
    elif k == 'DEAD':
        dead.append(entry)
    else:
        unknown.append(entry)

# also merge previous openai notebook lines that are not in current pool (optional keep)
# rebuild notebooks from this purge only (clean truth)

def to_note(entries):
    out = []
    for e in entries:
        p = e.split(':')
        out.append(f"{p[1]}:{p[2]}:{p[3]}:{p[4]}")
    return out

iso = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
cfg = b / 'config'
cfg.mkdir(parents=True, exist_ok=True)

def write_nb(name, title, lines):
    path = cfg / name
    body = f"# {title}\n# purged {iso}\n# host:port:user:pass\n"
    body += '\n'.join(lines) + ('\n' if lines else '')
    path.write_text(body, encoding='utf-8')
    return path

tg_notes = to_note(tg)
oa_notes = to_note(oa)
dead_notes = to_note(dead)

write_nb('proxies-tg-ok.txt', 'TG alive only (work PROXY_LIST)', tg_notes)
write_nb('proxies-openai-ok.txt', 'OpenAI/HTTPS alive but NOT Telegram', oa_notes)
write_nb('proxies-dead.txt', 'Dead everywhere (from last pool purge)', dead_notes)
(cfg / 'proxies.txt').write_text('# work proxies live in PROXY_LIST only\n', encoding='utf-8')

if len(tg) < 5:
    raise SystemExit(f'REFUSE: TG_OK only {len(tg)} < 5')

alive = ';'.join(tg)
oa_alive = ';'.join(oa)

env = b / '.env'
text = env.read_text(encoding='utf-8', errors='ignore')

def set_key(text, key, val):
    if re.search(rf'^{key}=', text, re.M):
        return re.sub(rf'^{key}=.*$', f'{key}={val}', text, count=1, flags=re.M)
    return text.rstrip() + f'\n{key}={val}\n'

text2 = set_key(text, 'PROXY_LIST', alive)
text2 = set_key(text2, 'OPENAI_PROXY_LIST', oa_alive)
env.write_text(text2, encoding='utf-8')

Path('/tmp/purge_PROXY_LIST.txt').write_text(alive, encoding='utf-8')
Path('/tmp/purge_OPENAI_PROXY_LIST.txt').write_text(oa_alive, encoding='utf-8')

print('TG_OK', len(tg))
print('OPENAI_ONLY', len(oa))
print('DEAD', len(dead))
print('UNKNOWN', len(unknown))
for e in tg:
    print('KEEP_TG', e)
for e in oa:
    print('MOVE_OA', e)
for e in dead:
    print('MOVE_DEAD', e)
PY

export PROXY_LIST="$(cat /tmp/purge_PROXY_LIST.txt)"
export OPENAI_PROXY_LIST="$(cat /tmp/purge_OPENAI_PROXY_LIST.txt)"
n=$(echo "$PROXY_LIST" | tr ';' '\n' | grep -c socks5 || true)
echo "PROXY_LEN=$n"
[ "$n" -ge 5 ] || { echo REFUSE; exit 1; }

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
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; oa=p["pm2_env"].get("OPENAI_PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()]),"pm2_OPENAI_LEN":len([x for x in oa.split(";") if x.strip()])})'
echo DONE
