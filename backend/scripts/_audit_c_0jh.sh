#!/bin/bash
# Hard жёсткий audit C · 0jh stack
set +e
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cd "$ROOT/backend"

# load .env for ultra/DB
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

echo '========== 1 smoke 0jh/0jg/0jf =========='
timeout 50 node scripts/_smoke_media_strip_0jh.js; echo SMOKE_JH_EXIT=$?
timeout 50 node scripts/_smoke_human_0jg.js; echo SMOKE_JG_EXIT=$?
if [ -f scripts/_smoke_human_0jf.js ]; then
  timeout 50 node scripts/_smoke_human_0jf.js; echo SMOKE_JF_EXIT=$?
else
  echo SMOKE_JF_SKIP
fi

echo '========== 2 hard 0jh =========='
timeout 50 node scripts/_hard_audit_0jh.js; echo HARD_JH_EXIT=$?

echo '========== 3 full hard 0ht =========='
timeout 180 node scripts/_hard_audit_full_0ht.js; echo FULL_EXIT=$?

echo '========== 4 ultra =========='
timeout 120 node scripts/_ultra_hard_audit.js > /tmp/ultra_c_0jh.json 2>/tmp/ultra_c_0jh.err
echo ULTRA_EXIT=$?
python3 - <<'PY'
import json,re
from pathlib import Path
raw=Path('/tmp/ultra_c_0jh.json').read_text(encoding='utf-8',errors='ignore')
# find last JSON object
m=None
for m in re.finditer(r'\{[\s\S]*\}', raw):
    pass
if not m:
    print('ULTRA_PARSE_FAIL')
    print(raw[-800:])
    print(Path('/tmp/ultra_c_0jh.err').read_text(errors='ignore')[-500:])
else:
    try:
        d=json.loads(m.group(0))
    except Exception as e:
        # try line-by-line findings dump
        print('ULTRA_JSON_PARTIAL', e)
        print(raw[-1200:])
        raise SystemExit(0)
    findings=d.get('findings') or []
    p0=[f for f in findings if f.get('sev')=='P0']
    p1=[f for f in findings if f.get('sev')=='P1']
    soft=[f for f in findings if f.get('sev') not in ('P0','P1')]
    print('ULTRA_SCORE', d.get('score'), 'P0', len(p0), 'P1', len(p1), 'soft', len(soft))
    for f in p0[:12]:
        print('P0', f.get('area'), f.get('name'), f.get('detail','')[:120])
    for f in p1[:12]:
        print('P1', f.get('area'), f.get('name'), f.get('detail','')[:120])
# also print P0_COUNT line if present
for line in raw.splitlines():
    if 'P0_COUNT' in line or 'SCORE' in line or 'score'==line.strip()[:5].lower():
        if 'P0_COUNT' in line or line.startswith('SCORE') or '"score"' in line:
            print('ULTRA_LINE', line[:200])
PY
tail -5 /tmp/ultra_c_0jh.err 2>/dev/null || true

echo '========== 5 nightly =========='
timeout 60 node scripts/_nightly_hard_audit.js; echo NIGHTLY_EXIT=$?

echo '========== 6 security env gates =========='
python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(errors='replace')
def g(k):
    m=re.search(rf'^{k}=(.*)$',t,re.M)
    return (m.group(1).strip() if m else 'missing')
bypass=g('TELEGRAM_AUTH_BYPASS')
force=g('TELEGRAM_AUTH_BYPASS_FORCE')
listen=g('LISTEN_HOST')
cors=g('CORS_ORIGIN')
node=g('NODE_ENV')
pl=g('PROXY_LIST')
n=len([x for x in pl.split(';') if x.strip()]) if pl!='missing' else 0
print({'NODE_ENV':node,'BYPASS':bypass,'BYPASS_FORCE':force,'LISTEN':listen,'CORS':cors,'PROXY_LEN':n})
# P0 gates
bad=[]
if bypass.lower() in ('1','true','yes','on'):
    bad.append('BYPASS_ON')
if listen not in ('127.0.0.1','localhost') and listen!='missing':
    # allow empty = default; warn if 0.0.0.0
    if listen in ('0.0.0.0','::'):
        bad.append('LISTEN_PUBLIC')
if cors=='*':
    bad.append('CORS_STAR')
if n<5:
    bad.append('PROXY_LT5')
print('SEC_GATES', 'FAIL' if bad else 'OK', bad)
PY

# static getUserId / CORS in code
python3 - <<'PY'
from pathlib import Path
gid=Path('lib/getUserId.js').read_text(errors='ignore')
srv=Path('server.js').read_text(errors='ignore')
auth=Path('middleware/telegramAuth.js').read_text(errors='ignore')
bad=[]
if 'return 1' in gid or 'fallback = 1' in gid or 'fallback=1' in gid:
    bad.append('getUserId_fallback_1')
if 'origin: true' in srv or "origin: '*'" in srv or 'origin:"*"' in srv:
    bad.append('cors_wildcard')
if 'TELEGRAM_AUTH_BYPASS_FORCE' not in auth:
    bad.append('no_bypass_force_key')
print('CODE_SEC', 'FAIL' if bad else 'OK', bad)
PY

echo '========== 7 live health / logs =========='
curl -sS http://127.0.0.1:3000/api/health; echo
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'pm2':e['status'],'PROXY':n,'online_hint':'see health'})
PY

echo '--- OUT ---'
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound ' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -35 || true
echo '--- ERR ---'
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|AUTH_KEY_DUPLICATED|OPENAI|TypeError|Cannot find' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -25 || true

echo '========== 8 v bump =========='
grep -oE 'updates.js\?v=[0-9]+' ../frontend/index.html | head -1
grep -n '^## 0jh' ../CHANGELOG_TG.md | head -1

echo AUDIT_C_0JH_DONE
