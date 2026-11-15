#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== audit B 0jr ==="
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
timeout 40 node scripts/_smoke_reply_screens_0jr.js
timeout 90 node scripts/_hard_audit_0ht.js || true
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()])})'
grep -q 'USER_ASKED_GEO_RE' services/aiResponder.js
grep -q 'ACTIVITY_FILLER_RE' services/humanThinLayer.js
echo AUDIT_B_0JR_DONE
