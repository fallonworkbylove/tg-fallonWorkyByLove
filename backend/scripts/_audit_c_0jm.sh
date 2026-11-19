#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$BASE"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

echo "=== C hard audit 0jm ==="
timeout 40 node scripts/_hard_audit_0jm.js
timeout 40 node scripts/_smoke_opt_0jm.js
timeout 120 node scripts/_ultra_hard_audit.js || true

grep -q 'enableKeepAlive' db.js
grep -q 'captionsCache' services/mediaReplies.js
grep -q 'flushTimer' services/opsQuality.js
grep -q 'OFFSET 5' services/nftCampaign.js
grep -q 'updates.js?v=193' ../frontend/index.html

pm2 jlist > /tmp/pm2j_c.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j_c.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
assert e['status']=='online' and n>=5
PY
curl -sS http://127.0.0.1:3000/api/health; echo
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|silence-heal|outbound ' /root/.pm2/logs/tgbot-out.log | tail -20 || true
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|TypeError|3306' /root/.pm2/logs/tgbot-error.log | tail -15 || true
echo AUDIT_C_0JM_OK
