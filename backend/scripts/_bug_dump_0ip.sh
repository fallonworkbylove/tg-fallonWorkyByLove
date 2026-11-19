#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node scripts/_ultra_hard_audit.js > /tmp/ultra_0ip.json 2>/tmp/ultra_0ip.err || true
python3 - <<'PY'
import json,re
from pathlib import Path
raw=Path('/tmp/ultra_0ip.json').read_text(encoding='utf-8',errors='ignore')
# extract outermost JSON object starting at first {
i=raw.find('{')
if i<0:
  print('NO_JSON'); print(raw[-500:]); raise SystemExit
# take from first { — file may be pure json
try:
  j=json.loads(raw[i:])
except Exception:
  # maybe mixed
  j=json.loads(raw[raw.index('{'):raw.rindex('}')+1])
print('overall', j.get('overall'))
print('P0', sum(1 for c in j.get('checks_detail',{}).get('ai',[]) if c.get('sev')=='P0' and not c.get('pass')))
print('findings', json.dumps(j.get('findings'), ensure_ascii=False, indent=2))
print('stale', json.dumps(j.get('stale_gaps'), ensure_ascii=False, indent=2))
print('stubs', json.dumps(j.get('stub_samples')[:5], ensure_ascii=False, indent=2))
PY
echo '====ERR_TAIL===='
grep -aE 'SocksClientError|TypeError|ReferenceError|REFUSE_PROXY' /root/.pm2/logs/tgbot-error.log | tail -15
echo '====PROXY===='
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print(p["pm2_env"]["status"], len([x for x in pl.split(";") if x.strip()]))'
