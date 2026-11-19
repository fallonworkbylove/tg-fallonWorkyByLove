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

echo "=== C hard audit 0jl ==="
timeout 50 node scripts/_hard_audit_0jl.js
timeout 45 node scripts/_smoke_opt_0jl.js
timeout 40 node scripts/_smoke_voprosy_dup_0jk.js || true

# live markers
grep -q 'NFT_TICK_MIN_MS' services/nftCampaign.js
grep -q 'triggersCache' services/voiceReplies.js
grep -q 'prepareOutboundText' services/replySendPrep.js
grep -q 'noteAuthKeyDuplicated' services/opsEvents.js
grep -q 'Быстрее и стабильнее внутри' ../frontend/updates.js
grep -q 'updates.js?v=192' ../frontend/index.html

# pm2 + health
pm2 jlist > /tmp/pm2j_c.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j_c.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n,'restarts':e.get('restart_time')})
assert e['status']=='online'
assert n>=5
PY
curl -sS http://127.0.0.1:3000/api/health; echo

# recent error glance (non-fatal)
grep -aE 'REFUSE_PROXY|Unhandled|TypeError|ECONNREFUSED' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -8 || true
echo AUDIT_C_0JL_OK
