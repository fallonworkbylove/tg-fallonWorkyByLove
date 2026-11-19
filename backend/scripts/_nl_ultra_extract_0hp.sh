#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
OPENAI_API_KEY=sk-x AUDIT_FIX_SINCE='2026-11-01 00:00:00' node scripts/_ultra_hard_audit.js > /tmp/ultra_0hp.json 2>/tmp/ultra_0hp.err || true
python3 <<'PY'
import json,re
raw=open('/tmp/ultra_0hp.json',encoding='utf-8',errors='ignore').read()
# strip banner lines before first {
i=raw.find('{')
j=raw.rfind('}')
d=json.loads(raw[i:j+1])
print('overall', d.get('overall'))
print('checks', d.get('checks'))
print('volume', d.get('volume'))
print('accounts', d.get('accounts'))
print('lengths', d.get('reply_length_since_fix'))
print('FINDINGS:')
for f in d.get('findings') or []:
    print('-', f.get('sev'), f.get('cat'), f.get('name'), f.get('detail'))
print('P0_COUNT', sum(1 for f in d.get('findings') or [] if f.get('sev')=='P0'))
PY
tail -5 /tmp/ultra_0hp.err 2>/dev/null || true
