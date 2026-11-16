#!/bin/bash
# Post-pm2 gate for LoveRussian deploys. Exit 1 → REFUSE_DEPLOY.
set -euo pipefail

echo "=== deploy_guard ==="

# 1) Scrub AUDIT_SMOKE from dump
python3 - <<'PY'
import json
from pathlib import Path
p = Path('/root/.pm2/dump.pm2')
if not p.exists():
    print('dump: missing')
    raise SystemExit(0)
data = json.loads(p.read_text())
n = 0
for app in data:
    for key in ('pm2_env', 'env'):
        env = app.get(key)
        if isinstance(env, dict) and 'AUDIT_SMOKE' in env:
            del env['AUDIT_SMOKE']
            n += 1
p.write_text(json.dumps(data))
print('dump_scrub_AUDIT_SMOKE', n)
PY

# 2) pm2 online + PROXY from env
pm2 jlist > /tmp/pm2j_guard.json
python3 - <<'PY'
import json
e = [x for x in json.load(open('/tmp/pm2j_guard.json')) if x['name'] == 'tgbot'][0]['pm2_env']
pl = e.get('PROXY_LIST') or ''
n = len([x for x in pl.split(';') if x.strip()])
smoke = e.get('AUDIT_SMOKE')
print({'status': e.get('status'), 'PROXY': n, 'AUDIT_SMOKE': smoke})
assert e.get('status') == 'online', 'tgbot not online'
assert n >= 5, 'REFUSE_PROXY'
if smoke not in (None, '', '0'):
    print('WARN live AUDIT_SMOKE still set — server.js must scrub; health.audit_smoke must be false')
PY

# 3) Health shape
sleep 1
health=$(curl -sS http://127.0.0.1:3000/api/health)
echo "health=$health"
python3 -c '
import json, sys
h = json.loads(sys.argv[1])
assert h.get("status") == "ok", h
assert h.get("openai_ready") is True, ("openai_ready", h)
assert int(h.get("proxy_len") or 0) >= 5, ("proxy_len", h)
assert h.get("audit_smoke") is False, ("audit_smoke", h)
print("health_gates_ok")
' "$health"

# 4) Soft: openai boot line (non-fatal if health.openai_ready)
if grep -aE '\[openai\] Запросы идут|\[openai\] Базовый URL' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -3 | grep -q .; then
  echo 'openai_boot_log=ok'
else
  echo 'WARN openai boot log line not found (non-fatal if health.openai_ready)'
fi

# 5) Dual changelog sync: updates.js?v=N must exist; top CHANGELOG tag present in updates title area
python3 - <<'PY'
from pathlib import Path
import re
base = Path('/root/opt/tgbot/tg-miniapp-loverussian')
idx = (base / 'frontend' / 'index.html').read_text(encoding='utf-8', errors='ignore')
m = re.search(r'updates\.js\?v=(\d+)', idx)
assert m, 'index missing updates.js?v='
v = m.group(1)
cl = (base / 'CHANGELOG_TG.md').read_text(encoding='utf-8', errors='ignore')
tag_m = re.search(r'^## (0[a-z0-9]+)\.', cl, re.M)
assert tag_m, 'CHANGELOG_TG missing top 0gX tag'
tag = tag_m.group(1)
fe = (base / 'frontend' / 'updates.js').read_text(encoding='utf-8', errors='ignore')
ops = (base / 'ops-console' / 'app' / 'updates.js')
ops_t = ops.read_text(encoding='utf-8', errors='ignore') if ops.exists() else ''
# v bump must be numeric; tag must appear in CHANGELOG note near top (first 2k)
head = cl[:2500]
assert tag in head, ('changelog tag not near top', tag)
assert 'LOVERUSSIAN_UPDATES' in fe and 'LOVERUSSIAN_UPDATES' in ops_t, 'dual updates missing'
print('changelog_sync', {'v': v, 'tag': tag})
PY

echo DEPLOY_GUARD_OK
