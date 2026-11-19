#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo ---ENV---
grep -E '^(AUDIT_SMOKE|OPENAI_API_KEY|OPENAI_FALLBACK_KEY|OPENAI_BASE_URL|OPENAI_PROXY_LIST)=' .env | sed -E 's/(KEY|LIST)=.*/\1=SET/' || true
echo ---PM2---
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
e=[x for x in json.load(open('/tmp/pm2j.json')) if x['name']=='tgbot'][0]['pm2_env']
keys=['AUDIT_SMOKE','OPENAI_API_KEY','OPENAI_FALLBACK_KEY','OPENAI_BASE_URL','OPENAI_PROXY_LIST','PROXY_LIST']
out={}
for k in keys:
  v=e.get(k)
  if v is None: continue
  if 'KEY' in k or 'LIST' in k:
    out[k]='SET_len_'+str(len(str(v)))
  else:
    out[k]=v
pl=e.get('PROXY_LIST') or ''
out['PROXY_LEN']=len([x for x in pl.split(';') if x.strip()])
out['status']=e.get('status')
print(out)
PY
echo ---CODE---
grep -n "AUDIT_SMOKE\|mediaClient\|let openai" services/aiResponder.js | head -30
echo ---RECENT---
grep -aE 'Cannot read properties of null|AUDIT_SMOKE|openai\]|REFUSE_PROXY|Ошибка распознавания' /root/.pm2/logs/tgbot-error.log | tail -25
