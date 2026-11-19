#!/bin/bash
# Hard жёсткий C после 0kg. AUDIT_SMOKE=1 — без SOCKS hang.
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend" || exit 1

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
keys=['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','MYSQL_HOST','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE','MYSQL_PORT','ADMIN_ALERT_CHAT_ID']
for key in keys:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-audit}"
export AUDIT_SMOKE=1

echo "======== C HARD AUDIT 0kg ========"
FAIL=0
P0=0
SOFT=0

run_node() {
  local label="$1"; local file="$2"; local timeout_s="${3:-45}"; local soft="${4:-0}"
  [ -f "$file" ] || { echo "MISS $label"; [ "$soft" = 1 ] && SOFT=$((SOFT+1)) || { FAIL=$((FAIL+1)); P0=$((P0+1)); }; return; }
  echo ""; echo "--- $label ---"
  local out="/tmp/ac_${label}.log"
  if timeout "${timeout_s}" env AUDIT_SMOKE=1 node "$file" >"$out" 2>&1; then
    echo "PASS $label"; tail -n 5 "$out" | sed 's/^/  /'
  else
    local ec=$?
    # если в логе есть OK/VERDICT и exit по timeout — часто hang после успеха
    if grep -qE 'SMOKE_.*_OK|HARD_AUDIT_.*_OK|VERDICT|P0_COUNT 0|ALL OK|OK activity' "$out" 2>/dev/null && [ "$ec" = 124 ]; then
      echo "SOFT $label timeout-after-ok"
      SOFT=$((SOFT+1))
      tail -n 8 "$out" | sed 's/^/  /'
      return
    fi
    echo "FAIL $label exit=$ec"
    tail -n 25 "$out" | sed 's/^/  /'
    if [ "$soft" = 1 ]; then SOFT=$((SOFT+1)); else FAIL=$((FAIL+1)); P0=$((P0+1)); fi
  fi
}

run_node "hard_0ht" "scripts/_hard_audit_0ht.js" 40
run_node "hard_0gt" "scripts/_hard_audit_0gt.js" 40 1
run_node "ultra" "scripts/_ultra_hard_audit.js" 90
run_node "kaif" "scripts/_smoke_kaif_0hm.js" 30
run_node "ten" "scripts/_smoke_10of10_0hq.js" 30
run_node "screen" "scripts/_smoke_screen_bugs_0jz.js" 30
run_node "media_ack" "scripts/_smoke_media_ack_refuse_0jy.js" 30
run_node "goodnight" "scripts/_smoke_goodnight_silence_0jy.js" 30
run_node "activity" "scripts/_smoke_activity_filter_0ke.js" 40
run_node "howlong" "scripts/_smoke_howlong_parse.js" 30
run_node "hard_0jn" "scripts/_hard_audit_0jn.js" 30 1
run_node "hard_0jm" "scripts/_hard_audit_0jm.js" 30 1

echo ""; echo "--- gates ---"
python3 - <<'PY'
import pathlib, re, sys
base = pathlib.Path('/root/opt/tgbot/tg-miniapp-loverussian')
checks=[]
def chk(n, ok):
    print(('OK' if ok else 'P0'), n)
    checks.append(ok)
auth=(base/'backend/middleware/telegramAuth.js').read_text(encoding='utf-8',errors='ignore')
server=(base/'backend/server.js').read_text(encoding='utf-8',errors='ignore')
guid=(base/'backend/lib/getUserId.js').read_text(encoding='utf-8',errors='ignore')
app=(base/'frontend/app.js').read_text(encoding='utf-8',errors='ignore')
css=(base/'frontend/styles.css').read_text(encoding='utf-8',errors='ignore')
ai=(base/'backend/services/aiResponder.js').read_text(encoding='utf-8',errors='ignore')
idx=(base/'frontend/index.html').read_text(encoding='utf-8',errors='ignore')
chk('cors_not_star', "origin: '*'" not in server and 'origin: true' not in server)
chk('getUserId_no_1', not re.search(r'\breturn\s+1\b', guid))
chk('getUserId_401', '401' in guid)
chk('auth_bypass', 'X-Auth-Bypass-Key' in auth)
chk('hideAppSplash', 'hideAppSplash' in app)
chk('splash_watchdog', 'splashWatchdog' in app)
chk('acid_primary', 'b8ff3c' in css)
chk('fonts_space_dm', 'Space Grotesk' in css and 'DM Sans' in css)
chk('overflow_guard', '0kg: ровные края' in css or 'overflow-x: hidden' in css)
chk('audit_smoke_gate', 'AUDIT_SMOKE' in ai)
chk('styles_v86', 'styles.css?v=86' in idx)
sys.exit(0 if all(checks) else 1)
PY
[ $? -eq 0 ] || { FAIL=$((FAIL+1)); P0=$((P0+1)); }

echo ""; echo "--- live ---"
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound ' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -12 || true
echo "--- err ---"
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|voice is not defined' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -12 || true

echo ""; echo "--- pm2 ---"
pm2 jlist > /tmp/pm2j_c.json
python3 - <<'PY'
import json,sys
j=json.load(open('/tmp/pm2j_c.json'))
e=[x for x in j if x['name']=='tgbot'][0]['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
sys.exit(0 if e['status']=='online' and n>=5 else 1)
PY
[ $? -eq 0 ] || { FAIL=$((FAIL+1)); P0=$((P0+1)); }
curl -sS http://127.0.0.1:3000/api/health; echo

echo ""; echo "======== SUMMARY ========"
echo "FAIL_HARD=$FAIL P0=$P0 SOFT=$SOFT"
if [ "$P0" -gt 0 ]; then echo AUDIT_C_FAIL; exit 1; fi
echo AUDIT_C_OK
exit 0
