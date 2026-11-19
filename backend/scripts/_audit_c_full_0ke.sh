#!/bin/bash
# Hard жёсткий (C) — полный аудит проекта. Без `source .env` (PROXY_LIST ломает bash).
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend" || exit 1

# Safe env load for node only
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text = Path('.env').read_text(encoding='utf-8', errors='ignore')
for key in [
  'OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST',
  'DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT',
  'MYSQL_HOST','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE','MYSQL_PORT',
  'ADMIN_ALERT_CHAT_ID','TELEGRAM_AUTH_BYPASS_KEY'
]:
    m = re.search(rf'^{re.escape(key)}=(.*)$', text, re.M)
    if not m: continue
    print('export %s=%s' % (key, shlex.quote(m.group(1).strip())))
PY
)"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-audit}"

echo "======== C HARD FULL AUDIT 0ke ========"
echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FAIL=0
P0=0
SOFT=0

run_node() {
  local label="$1"
  local file="$2"
  local timeout_s="${3:-90}"
  local soft="${4:-0}"
  if [ ! -f "$file" ]; then
    echo "MISS $label"
    if [ "$soft" = "1" ]; then SOFT=$((SOFT+1)); else FAIL=$((FAIL+1)); P0=$((P0+1)); fi
    return
  fi
  echo ""
  echo "--- $label (timeout ${timeout_s}s) ---"
  local out="/tmp/auditc_${label//\//_}.log"
  if timeout "${timeout_s}" node "$file" >"$out" 2>&1; then
    echo "PASS $label"
    tail -n 8 "$out" | sed 's/^/  /'
  else
    local ec=$?
    echo "FAIL $label exit=$ec"
    tail -n 40 "$out" | sed 's/^/  /'
    if [ "$soft" = "1" ]; then
      SOFT=$((SOFT+1))
      echo "  (soft/historical — не P0)"
    else
      FAIL=$((FAIL+1))
      P0=$((P0+1))
    fi
  fi
}

# Core hard (current)
run_node "hard_0ht" "scripts/_hard_audit_0ht.js" 60
run_node "hard_0gc" "scripts/_hard_audit_0gc.js" 90
run_node "hard_0gt" "scripts/_hard_audit_0gt.js" 60 1

# Full suite (can mark stale nested fails)
run_node "full_0ht" "scripts/_hard_audit_full_0ht.js" 180

# Ultra DB (preferred on VPS)
run_node "ultra" "scripts/_ultra_hard_audit.js" 120

# Nightly
run_node "nightly" "scripts/_nightly_hard_audit.js" 90 1

# Historical tag audits — soft (version bump gates)
run_node "hard_0jn" "scripts/_hard_audit_0jn.js" 60 1
run_node "hard_0jm" "scripts/_hard_audit_0jm.js" 60 1

# Fresh smokes
for s in \
  scripts/_smoke_activity_filter_0ke.js \
  scripts/_smoke_media_ack_refuse_0jy.js \
  scripts/_smoke_goodnight_silence_0jy.js \
  scripts/_smoke_screen_bugs_0jz.js \
  scripts/_smoke_kaif_0hm.js \
  scripts/_smoke_10of10_0hq.js \
  scripts/_smoke_howlong_parse.js \
  scripts/_smoke_ops_quality.js
do
  [ -f "$s" ] || continue
  run_node "smoke_$(basename "$s" .js)" "$s" 60
done

echo ""
echo "--- live greps ---"
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound ' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -40 || true
echo "--- error greps ---"
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|voice is not defined' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -30 || true

echo ""
echo "--- security / wiring gates ---"
python3 - <<'PY'
import pathlib, re, sys
base = pathlib.Path('/root/opt/tgbot/tg-miniapp-loverussian')
auth = (base/'backend/middleware/telegramAuth.js').read_text(encoding='utf-8', errors='ignore')
server = (base/'backend/server.js').read_text(encoding='utf-8', errors='ignore')
guid = (base/'backend/lib/getUserId.js').read_text(encoding='utf-8', errors='ignore')
accounts = (base/'backend/routes/accounts.js').read_text(encoding='utf-8', errors='ignore')
app = (base/'frontend/app.js').read_text(encoding='utf-8', errors='ignore')
ops = (base/'backend/services/opsActivityLog.js').read_text(encoding='utf-8', errors='ignore')
hh = (base/'backend/services/humanHardening.js').read_text(encoding='utf-8', errors='ignore')
oq = (base/'backend/services/opsQuality.js').read_text(encoding='utf-8', errors='ignore')
oh = (base/'backend/services/howLong.js').read_text(encoding='utf-8', errors='ignore')
obj = (base/'backend/services/objectionHandler.js').read_text(encoding='utf-8', errors='ignore')
idx = (base/'frontend/index.html').read_text(encoding='utf-8', errors='ignore')
p0 = 0
def chk(name, ok):
    global p0
    print(('OK' if ok else 'P0'), name)
    if not ok: p0 += 1
chk('cors_not_star', 'origin: true' not in server and "origin: '*'" not in server)
chk('getUserId_no_fallback_1', not re.search(r'\breturn\s+1\b', guid))
chk('getUserId_401', '401' in guid)
chk('auth_bypass_gated', 'X-Auth-Bypass-Key' in auth)
chk('accounts_activity_route', "router.get('/activity'" in accounts)
chk('activity_accountIds', 'accountIds' in ops)
chk('worker_feed_ui', 'worker-activity-list' in idx and 'getWorkerActivity' in app)
chk('escapeHtml', 'function escapeHtml' in app)
chk('phraseBan_wiring', 'phraseBanLimitFor' in hh)
chk('howlong_21', 'HOWLONG_ARCHIVE_DAYS' in oh and '21' in oh)
chk('flip_guard', re.search(r'это\s*я|не я|flip', obj, re.I) is not None)
chk('opsQuality_schedulers', 'startOpsQualitySchedulers' in oq)
sys.exit(1 if p0 else 0)
PY
if [ $? -ne 0 ]; then FAIL=$((FAIL+1)); P0=$((P0+1)); fi

echo ""
echo "--- pm2 / proxy ---"
pm2 jlist > /tmp/pm2j_audit.json
python3 - <<'PY'
import json,sys
j=json.load(open('/tmp/pm2j_audit.json'))
e=[x for x in j if x['name']=='tgbot'][0]['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
sys.exit(0 if e['status']=='online' and n>=5 else 1)
PY
if [ $? -ne 0 ]; then FAIL=$((FAIL+1)); P0=$((P0+1)); echo P0 proxy_or_offline; fi
curl -sS http://127.0.0.1:3000/api/health; echo

echo ""
echo "======== SUMMARY ========"
echo "FAIL_HARD=$FAIL P0=$P0 SOFT=$SOFT"
if [ "$P0" -gt 0 ]; then
  echo "AUDIT_C_FAIL"
  exit 1
fi
echo "AUDIT_C_OK"
exit 0
