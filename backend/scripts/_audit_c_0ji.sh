#!/bin/bash
set +e
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cd "$ROOT/backend"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','OPENAI_API_KEY','PROXY_LIST','BOT_TOKEN','NODE_ENV','TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE','LISTEN_HOST','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-smoke-test-not-real}"

echo '========== 1 smoke+hard 0ji =========='
timeout 60 node scripts/_smoke_bundle_0ji.js; echo SMOKE=$?
timeout 60 node scripts/_hard_audit_0ji.js; echo HARD=$?

echo '========== 2 full 0ht =========='
timeout 180 node scripts/_hard_audit_full_0ht.js; echo FULL=$?

echo '========== 3 ultra =========='
timeout 120 node scripts/_ultra_hard_audit.js > /tmp/ultra_c_0ji.json 2>/tmp/ultra_c_0ji.err
echo ULTRA=$?
python3 - <<'PY'
import json,re
from pathlib import Path
raw=Path('/tmp/ultra_c_0ji.json').read_text(encoding='utf-8',errors='ignore')
idx=raw.find('{')
if idx<0:
    print('ULTRA_PARSE_FAIL'); print(raw[-500:]); raise SystemExit(0)
d=json.loads(raw[idx:raw.rfind('}')+1])
findings=d.get('findings') or []
p0=[f for f in findings if f.get('sev')=='P0']
p1=[f for f in findings if f.get('sev')=='P1']
print('ULTRA_SCORE', d.get('score'), 'P0', len(p0), 'P1', len(p1))
for f in p0[:8]:
    print('P0', f.get('area'), f.get('name'), str(f.get('detail',''))[:100])
for f in p1[:8]:
    print('P1', f.get('area'), f.get('name'), str(f.get('detail',''))[:100])
for line in raw.splitlines():
    if 'P0_COUNT' in line: print('ULTRA_LINE', line)
PY

echo '========== 4 nightly =========='
timeout 90 node scripts/_nightly_hard_audit.js; echo NIGHTLY=$?

echo '========== 5 security =========='
python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(errors='replace')
def g(k):
    m=re.search(rf'^{k}=(.*)$',t,re.M)
    return (m.group(1).strip() if m else 'missing')
bypass=g('TELEGRAM_AUTH_BYPASS')
cors=g('CORS_ORIGIN')
listen=g('LISTEN_HOST')
pl=g('PROXY_LIST')
n=len([x for x in pl.split(';') if x.strip()]) if pl!='missing' else 0
bad=[]
if bypass.lower() in ('1','true','yes','on'): bad.append('BYPASS_ON')
if cors=='*': bad.append('CORS_STAR')
if listen in ('0.0.0.0','::'): bad.append('LISTEN_PUBLIC')
if n<5: bad.append('PROXY_LT5')
print({'BYPASS':bypass,'CORS':cors or '(empty)','LISTEN':listen,'PROXY':n})
print('SEC', 'FAIL' if bad else 'OK', bad)
PY

echo '========== 6 live =========='
curl -sS http://127.0.0.1:3000/api/health; echo
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'pm2':e['status'],'PROXY':n})
PY
grep -aE 'NFT|Перед NFT|голосовое про NFT|AUTH_KEY|AI замолчал|отсев' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -20 || true
grep -aE 'AUTH_KEY_DUPLICATED|REFUSE_PROXY|PEER_ID_INVALID' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -12 || true
grep -oE 'updates.js\?v=[0-9]+' ../frontend/index.html | head -1
echo AUDIT_C_0JI_DONE
