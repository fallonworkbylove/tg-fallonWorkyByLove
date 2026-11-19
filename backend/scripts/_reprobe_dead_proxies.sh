#!/bin/bash
# Daily/scheduled: re-probe proxies-dead.txt.
# TG revived → PROXY_LIST + tg notebook; OpenAI-only → openai notebook; rest stay dead.
# Cron example (MSK≈UTC+3 on UTC VPS): 0 4,16 * * *  → 07:00 and 19:00 MSK
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
LOG_DIR=/root/logs
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/proxy-dead-reprobe.log"
exec >>"$LOG" 2>&1
echo "===== $(date -Is) reprobe dead start ====="
cd "$B"

OUT=/tmp/reprobe_dead_out.txt
PROXY_CFG_DIR="$B/config" /usr/bin/node scripts/_reprobe_dead_proxies.js | tee "$OUT"

python3 - <<'PY'
import json, re, shlex
from pathlib import Path
from datetime import datetime, timezone
from subprocess import check_output

b = Path('/root/opt/tgbot/tg-miniapp-loverussian/backend')
cfg = b / 'config'
out = Path('/tmp/reprobe_dead_out.txt').read_text(encoding='utf-8', errors='ignore')
iso = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

def section(name):
    lines = out.splitlines()
    mode = None
    got = []
    for ln in lines:
        s = ln.strip()
        if s == name:
            mode = name
            continue
        if s.endswith('_LINES') and s != name:
            mode = None
            continue
        if mode == name:
            parts = s.split(':')
            if len(parts) == 4 and parts[0][:1].isdigit():
                got.append(s)
    return got

tg_new = section('TG_LINES')
oa_new = section('OPENAI_LINES')
still = section('STILL_DEAD_LINES')

def read_notes(path):
    if not path.exists():
        return []
    return [l.strip() for l in path.read_text(encoding='utf-8', errors='ignore').splitlines()
            if l.strip() and not l.strip().startswith('#')]

def write_notes(path, title, lines):
    seen = set()
    uniq = []
    for l in lines:
        h = l.split(':')[0]
        if h in seen:
            continue
        seen.add(h)
        uniq.append(l)
    body = f'# {title}\n# updated {iso} dead-reprobe\n# host:port:user:pass\n'
    body += '\n'.join(uniq) + ('\n' if uniq else '')
    path.write_text(body, encoding='utf-8')
    return uniq

tg_path = cfg / 'proxies-tg-ok.txt'
oa_path = cfg / 'proxies-openai-ok.txt'
dead_path = cfg / 'proxies-dead.txt'

# notebooks: dead = still only; merge revived into tg/oa
tg_all = write_notes(tg_path, 'TG alive only (work PROXY_LIST)', read_notes(tg_path) + tg_new)
oa_all = write_notes(oa_path, 'OpenAI/HTTPS alive but NOT Telegram', read_notes(oa_path) + oa_new)
# strip hosts that moved out of dead
moved = {l.split(':')[0] for l in tg_new + oa_new}
dead_kept = [l for l in still if l.split(':')[0] not in moved]
# also drop from dead any host now in tg/oa
alive_hosts = {l.split(':')[0] for l in tg_all + oa_all}
dead_kept = [l for l in dead_kept if l.split(':')[0] not in alive_hosts]
write_notes(dead_path, 'Dead everywhere', dead_kept)

def to_socks(lines):
    return [f'socks5:{l}' for l in lines]

# sync env from notebooks (tg → PROXY_LIST, oa → OPENAI_PROXY_LIST)
proxy_list = ';'.join(to_socks(tg_all))
openai_list = ';'.join(to_socks(oa_all))

if len(tg_all) < 5:
    print(f'REFUSE_WRITE: TG notebook only {len(tg_all)} < 5 — keep existing PROXY_LIST')
    Path('/tmp/reprobe_need_restart').write_text('0', encoding='utf-8')
    Path('/tmp/reprobe_stats.json').write_text(json.dumps({
        'revived_tg': len(tg_new), 'revived_openai': len(oa_new), 'still_dead': len(dead_kept),
        'tg_pool': len(tg_all), 'refused': True,
    }), encoding='utf-8')
    raise SystemExit(0)

env = b / '.env'
text = env.read_text(encoding='utf-8', errors='ignore')

def set_key(text, key, val):
    if re.search(rf'^{key}=', text, re.M):
        return re.sub(rf'^{key}=.*$', f'{key}={val}', text, count=1, flags=re.M)
    return text.rstrip() + f'\n{key}={val}\n'

# compare previous PROXY_LIST hosts
m = re.search(r'^PROXY_LIST=(.*)$', text, re.M)
old = (m.group(1).strip() if m else '')
old_hosts = set()
for e in old.split(';'):
    e = e.strip()
    if not e:
        continue
    p = e.split(':')
    if p[0] == 'socks5' and len(p) >= 2:
        old_hosts.add(p[1])

new_hosts = {l.split(':')[0] for l in tg_all}
changed = (new_hosts != old_hosts) or (len(tg_new) > 0)

text2 = set_key(text, 'PROXY_LIST', proxy_list)
text2 = set_key(text2, 'OPENAI_PROXY_LIST', openai_list)
env.write_text(text2, encoding='utf-8')
Path('/tmp/reprobe_PROXY_LIST.txt').write_text(proxy_list, encoding='utf-8')
Path('/tmp/reprobe_OPENAI_PROXY_LIST.txt').write_text(openai_list, encoding='utf-8')
Path('/tmp/reprobe_need_restart').write_text('1' if changed else '0', encoding='utf-8')
Path('/tmp/reprobe_stats.json').write_text(json.dumps({
    'revived_tg': len(tg_new),
    'revived_openai': len(oa_new),
    'still_dead': len(dead_kept),
    'tg_pool': len(tg_all),
    'openai_pool': len(oa_all),
    'changed': changed,
    'tg_new': tg_new,
    'oa_new': oa_new,
}), encoding='utf-8')
print('REVIVED_TG', len(tg_new), tg_new)
print('REVIVED_OPENAI', len(oa_new), oa_new)
print('STILL_DEAD', len(dead_kept))
print('TG_POOL', len(tg_all), 'OPENAI_POOL', len(oa_all), 'CHANGED', changed)
PY

NEED=$(cat /tmp/reprobe_need_restart 2>/dev/null || echo 0)
STATS=$(cat /tmp/reprobe_stats.json 2>/dev/null || echo '{}')
echo "STATS $STATS"

if [ "$NEED" = "1" ]; then
  echo "restarting tgbot — PROXY_LIST changed"
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
  n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
  echo "PROXY_LEN=$n"
  if [ "$n" -lt 5 ]; then
    echo "REFUSE restart: PROXY_LEN < 5"
    exit 1
  fi
  pm2 restart tgbot --update-env
  pm2 save
  sleep 2
  pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()])})'
else
  echo "no PROXY_LIST change — skip restart"
fi
echo "===== $(date -Is) reprobe dead end ====="
