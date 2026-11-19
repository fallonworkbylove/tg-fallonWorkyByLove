#!/bin/bash
# Live hard audit greps + pool counts on NL VPS
set -euo pipefail
echo "=== PROXY / LOGIN ==="
python3 - <<'PY'
import json
from pathlib import Path
from subprocess import check_output
j=json.loads(check_output(['pm2','jlist'],text=True))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
pl=(e.get('PROXY_LIST') or '')
print({'status':e.get('status'),'PROXY':len([x for x in pl.split(';') if x.strip()]),'uptime':e.get('pm_uptime')})
lp=Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/config/proxies-login.txt')
print('login_lines', sum(1 for l in lp.read_text(encoding='utf-8',errors='ignore').splitlines() if l.strip() and not l.startswith('#')))
PY

echo "=== HUMAN / HOWLONG / SILENCE ==="
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound ' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -40 || true
zcat -f /root/.pm2/logs/tgbot-out.log.1.gz 2>/dev/null | grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал' | tail -20 || true

echo "=== ERRORS ==="
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|OPENAI' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -25 || true

echo "=== FLIP / KAIF SAMPLE ==="
grep -aE 'это я|бород|кайф' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -20 || true

echo "=== RECENT REPLIES ==="
grep -a 'Ответ для' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -15 || true

echo "=== NIGHTLY STATIC ==="
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
OPENAI_API_KEY=sk-smoke-test-not-real node scripts/_nightly_hard_audit.js || true
OPENAI_API_KEY=sk-smoke-test-not-real node scripts/_hard_audit_0gc.js || true
