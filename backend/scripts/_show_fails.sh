#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
AUDIT_FIX_SINCE='2026-10-27 15:52:00' node scripts/_ultra_hard_audit.js > /tmp/u.txt || true
python3 - <<'PY'
import json
t=open('/tmp/u.txt',encoding='utf-8').read()
o=json.loads(t[t.find('{'):t.rfind('}')+1])
print('overall', o['overall'], 'checks', o['checks'])
print('score', o['score'])
print('findings', json.dumps(o['findings'], ensure_ascii=False, indent=2))
print('stale', o.get('stale_gaps'))
fails=[]
for k,arr in o.get('checks_detail',{}).items():
  for c in arr:
    if not c['pass']:
      fails.append(f"{k}:{c['name']} {c.get('detail','')}")
print('FAILS:')
for f in fails: print(' -', f)
# confirms check - maybe typo Стереть история vs истории
PY
# fix confirms regex if needed locally on VPS audit file
grep -n "confirms_danger\|Стереть" scripts/_ultra_hard_audit.js | head -5
grep -n "Стереть историю" /root/opt/tgbot/tg-miniapp-loverussian/frontend/app.js | head -3
