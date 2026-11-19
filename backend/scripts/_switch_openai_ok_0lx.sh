#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$BASE"
OK=config/proxies-openai-ok.txt
[ -s "$OK" ] || { echo REFUSE_NO_OPENAI_OK; exit 1; }

python3 - <<'PY'
from pathlib import Path
import re, shlex

lines = []
for raw in Path('config/proxies-openai-ok.txt').read_text(encoding='utf-8', errors='ignore').splitlines():
    s = raw.strip()
    if not s or s.startswith('#'):
        continue
    parts = s.split(':')
    if len(parts) < 2:
        continue
    if parts[0].lower() in ('socks5', 'socks'):
        entry = s if s.lower().startswith('socks') else 'socks5:' + ':'.join(parts[1:])
    else:
        entry = 'socks5:' + s
    lines.append(entry)

seen = set()
out = []
for x in lines:
    if x in seen:
        continue
    seen.add(x)
    out.append(x)
out = out[:20]
print('OPENAI_OK_LEN', len(out))
if len(out) < 5:
    raise SystemExit('REFUSE_OPENAI_OK_SHORT')

val = ';'.join(out)
env = Path('.env')
text = env.read_text(encoding='utf-8', errors='ignore')
if re.search(r'^OPENAI_PROXY_LIST=', text, re.M):
    text = re.sub(r'^OPENAI_PROXY_LIST=.*$', 'OPENAI_PROXY_LIST=' + val, text, count=1, flags=re.M)
else:
    text = text.rstrip() + '\nOPENAI_PROXY_LIST=' + val + '\n'
env.write_text(text, encoding='utf-8')
print('env_patched')
PY

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text = Path('.env').read_text(encoding='utf-8', errors='ignore')
for key in ['OPENAI_API_KEY', 'PROXY_LIST', 'OPENAI_PROXY_LIST']:
    m = re.search(rf'^{re.escape(key)}=(.*)$', text, re.M)
    if m:
        print('export %s=%s' % (key, shlex.quote(m.group(1).strip())))
PY
)"
unset AUDIT_SMOKE || true
case "${OPENAI_API_KEY:-}" in
  ''|sk-deploy*|sk-audit*|sk-test*) echo REFUSE_OPENAI_FAKE; exit 1;;
esac
echo "EXPORT_OPENAI_PROXY_LEN=$(python3 - <<'PY'
import os
print(len([x for x in os.environ.get('OPENAI_PROXY_LIST','').split(';') if x.strip()]))
PY
)"

pm2 restart tgbot --update-env
pm2 save
sleep 12
bash scripts/_deploy_guard.sh
sleep 100
echo "--- heal after openai-ok ---"
grep -aE 'silence-heal: догоняю|sync TG|healed ' /root/.pm2/logs/tgbot-out.log | tail -20
grep -aE 'Ответ для' /root/.pm2/logs/tgbot-out.log | tail -15
bash /tmp/fw.sh 2>/dev/null || true
echo SWITCH_OPENAI_OK_0LX_DONE
