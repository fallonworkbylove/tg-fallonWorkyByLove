#!/bin/bash
# Probe PROXY_LIST + OPENAI_PROXY_LIST → keep alive OpenAI socks; dead → proxies-dead.
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$B"

python3 - <<'PY'
import json, re, socket, time
from pathlib import Path
from subprocess import check_output, run

try:
    from socks import socksocket, PROXY_TYPE_SOCKS5
except ImportError:
    import subprocess
    subprocess.check_call(['pip3', 'install', '-q', 'PySocks'])
    from socks import socksocket, PROXY_TYPE_SOCKS5

b = Path('/root/opt/tgbot/tg-miniapp-loverussian/backend')
env = (b / '.env').read_text(encoding='utf-8', errors='ignore')

def env_key(k):
    m = re.search(rf'^{re.escape(k)}=(.*)$', env, re.M)
    return (m.group(1).strip() if m else '')

def parse_list(raw):
    out = []
    for e in raw.split(';'):
        e = e.strip()
        if not e:
            continue
        p = e.split(':')
        if len(p) < 5 or p[0].lower() not in ('socks5', 'socks'):
            continue
        out.append({'entry': e, 'host': p[1], 'port': int(p[2]), 'user': p[3], 'pass': p[4]})
    return out

# Prefer pm2 live env
j = json.loads(check_output(['pm2', 'jlist'], text=True))
proc = [x for x in j if x['name'] == 'tgbot'][0]
pm = proc['pm2_env']
work_raw = pm.get('PROXY_LIST') or env_key('PROXY_LIST')
oa_raw = pm.get('OPENAI_PROXY_LIST') or env_key('OPENAI_PROXY_LIST')

# Merge unique by host:port
seen = {}
for src, label in ((work_raw, 'work'), (oa_raw, 'oa')):
    for px in parse_list(src):
        key = f"{px['host']}:{px['port']}"
        if key not in seen:
            px['src'] = label
            seen[key] = px

def probe_openai(px, timeout=7.0):
    s = socksocket()
    s.set_proxy(PROXY_TYPE_SOCKS5, px['host'], px['port'], True, px['user'], px['pass'])
    s.settimeout(timeout)
    try:
        s.connect(('api.openai.com', 443))
        s.close()
        return True, 'ok'
    except Exception as e:
        try:
            s.close()
        except Exception:
            pass
        return False, str(e).split('\n')[0][:80]

alive, dead = [], []
print(f'PROBE_TOTAL {len(seen)}')
for key, px in seen.items():
    ok, msg = probe_openai(px)
    tag = 'OK' if ok else 'DEAD'
    print(f'{tag} {key} src={px["src"]} {msg}')
    if ok:
        alive.append(px)
    else:
        dead.append(px)

if len(alive) < 5:
    raise SystemExit(f'REFUSE: openai-alive {len(alive)} < 5')

# Work PROXY_LIST: prefer previous work hosts that still openai-ok; fill from alive
work_hosts = {f"{p['host']}:{p['port']}" for p in parse_list(work_raw)}
work_alive = [p for p in alive if f"{p['host']}:{p['port']}" in work_hosts]
if len(work_alive) < 5:
    # top up from other openai-ok
    for p in alive:
        if p not in work_alive:
            work_alive.append(p)
        if len(work_alive) >= 9:
            break

oa_alive = [p for p in alive if p not in work_alive][:24]
# Also keep work proxies in OPENAI list (failover)
oa_merged = work_alive + [p for p in oa_alive if f"{p['host']}:{p['port']}" not in {f"{x['host']}:{x['port']}" for x in work_alive}]

proxy_list = ';'.join(p['entry'] for p in work_alive[:12])
openai_list = ';'.join(p['entry'] for p in oa_merged[:30])

cfg = b / 'config'
cfg.mkdir(parents=True, exist_ok=True)
iso = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

def write_nb(name, title, entries):
    lines = [f'# {title}', f'# purged {iso}', '# host:port:user:pass']
    for p in entries:
        lines.append(f"{p['host']}:{p['port']}:{p['user']}:{p['pass']}")
    (cfg / name).write_text('\n'.join(lines) + '\n', encoding='utf-8')

write_nb('proxies-tg-ok.txt', 'work PROXY after openai purge (need TG recheck separately)', work_alive[:12])
write_nb('proxies-openai-ok.txt', 'OpenAI-alive socks', oa_merged[:30])
# append dead
dead_path = cfg / 'proxies-dead.txt'
prev = dead_path.read_text(encoding='utf-8', errors='ignore') if dead_path.exists() else ''
prev_hosts = set(re.findall(r'^(\d+\.\d+\.\d+\.\d+):', prev, re.M))
extra = []
for p in dead:
    if p['host'] not in prev_hosts:
        extra.append(f"{p['host']}:{p['port']}:{p['user']}:{p['pass']}")
if extra:
    with dead_path.open('a', encoding='utf-8') as f:
        f.write(f'\n# openai-purge {iso}\n')
        f.write('\n'.join(extra) + '\n')

def set_key(text, key, val):
    if re.search(rf'^{key}=', text, re.M):
        return re.sub(rf'^{key}=.*$', f'{key}={val}', text, count=1, flags=re.M)
    return text.rstrip() + f'\n{key}={val}\n'

text2 = set_key(env, 'PROXY_LIST', proxy_list)
text2 = set_key(text2, 'OPENAI_PROXY_LIST', openai_list)
(b / '.env').write_text(text2, encoding='utf-8')
Path('/tmp/purge0hf_PROXY_LIST.txt').write_text(proxy_list, encoding='utf-8')
Path('/tmp/purge0hf_OPENAI_PROXY_LIST.txt').write_text(openai_list, encoding='utf-8')
print('KEEP_WORK', len(work_alive[:12]))
print('KEEP_OPENAI', len(oa_merged[:30]))
print('DEAD_NOW', len(dead))
PY

export PROXY_LIST="$(cat /tmp/purge0hf_PROXY_LIST.txt)"
export OPENAI_PROXY_LIST="$(cat /tmp/purge0hf_OPENAI_PROXY_LIST.txt)"
n=$(echo "$PROXY_LIST" | tr ';' '\n' | grep -c socks5 || true)
echo "PROXY_LEN=$n"
[ "$n" -ge 5 ] || { echo REFUSE; exit 1; }
oa_n=$(echo "$OPENAI_PROXY_LIST" | tr ';' '\n' | grep -c socks5 || true)
echo "OPENAI_LEN=$oa_n"
echo PURGE_LISTS_WRITTEN
