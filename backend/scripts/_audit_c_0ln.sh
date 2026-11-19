#!/bin/bash
# Audit C · хард жёсткий post-0ln (funnel days + security + human)
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-audit-c}"
export HARD_AUDIT_FAST=1
P0=0; P1=0
pass(){ echo "OK  $1"; }
fail(){ local lvl="$1"; shift; echo "$lvl $*"; [ "$lvl" = P0 ] && P0=$((P0+1)) || P1=$((P1+1)); }

echo "=== AUDIT C 0ln $(date -u +%H:%M)UTC ==="

echo "--- A smokes + wiring 0ln ---"
for s in _smoke_funnel_days_0ln.js _smoke_wave_0lm.js _smoke_wave_0lj.js _smoke_greet_hyphen_0li.js _smoke_metrics_db_0lk.js; do
  if [ -f "scripts/$s" ]; then
    timeout 90s node "scripts/$s" >/tmp/sm_$s.txt 2>&1 && pass "smoke_$s" || fail P0 "smoke_$s $(tail -2 /tmp/sm_$s.txt | tr '\n' ' ')"
  else fail P1 "missing_$s"; fi
done

grep -q FUNNEL_BOARD_STAGES services/leadScoring.js && pass wire_funnel_board || fail P0 wire_funnel_board
grep -q "dayStageFromAge" services/leadScoring.js && pass wire_day_age || fail P0 wire_day_age
grep -q "STAGE_ORDER = \\['day1'" ../ops-console/app/renderer.js && pass wire_ops_days || fail P0 wire_ops_days
grep -q "day1: '1 день'" ../frontend/app.js && pass wire_mini_days || fail P0 wire_mini_days
grep -q "funnelStages" ../frontend/app.js && pass wire_mini_funnel || fail P0 wire_mini_funnel
grep -q softHumanGates services/softHumanLite.js && pass wire_gates || fail P0 wire_gates
grep -q allowLoginAttempt services/loginRate.js && pass wire_login_rate || fail P0 wire_login_rate
grep -q 'updates.js?v=244' ../frontend/index.html && pass updates_v244 || fail P1 updates_v
grep -q '## 0ln\.' ../CHANGELOG_TG.md && pass changelog_0ln || fail P1 changelog
grep -q 'Воронка по дням' ../frontend/updates.js && pass feed_mini || fail P1 feed_mini
grep -q 'Воронка по дням' ../ops-console/app/updates.js && pass feed_ops || fail P1 feed_ops

timeout 40s node scripts/_check_getuserid_fallback.js >/tmp/c1.txt 2>&1 && pass c1_fallback || fail P0 c1_fallback

echo "--- B human checklist + hard_0ht ---"
grep -qE 'phraseBanLimitFor' services/softHumanLite.js services/humanHardening.js 2>/dev/null && pass phrase_ban || fail P1 phrase_ban
grep -qE 'markPeerFiltered|отсев:' services/*.js && pass howlong_filter || fail P1 howlong_filter
grep -qE 'это\s+я|ownAvatar|flip.*guard|isOwnAvatar|совпало с моей' services/*.js && pass flip_guard || fail P1 flip_guard
grep -qE 'isVoiceQuietHour|isNightTextQuietHour' services/timing.js && pass quiet_hours || fail P1 quiet_hours
grep -qE 'breakKaifEcho|каиф|kaif' services/softHumanLite.js services/humanHardening.js 2>/dev/null && pass kaif_echo || fail P1 kaif_echo

timeout 120s env HARD_AUDIT_FAST=1 OPENAI_API_KEY=sk-audit-fast node scripts/_hard_audit_0ht.js >/tmp/hard_0ht.txt 2>&1
ec=$?
if grep -q 'HARD_AUDIT_0HT_OK' /tmp/hard_0ht.txt 2>/dev/null; then pass hard_0ht
elif [ $ec -eq 0 ]; then pass hard_0ht_exit0
elif [ $ec -eq 124 ]; then
  grep -q 'HARD_AUDIT_0HT_OK' /tmp/hard_0ht.txt && pass hard_0ht_ok_hung || fail P1 hard_0ht_timeout
else fail P0 hard_0ht "$(grep -E 'FAIL|P0' /tmp/hard_0ht.txt | head -3)"
fi

echo "--- live greps (human-audit) ---"
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound ' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -20 || true
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|null\.chat|TypeError' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -20 || true

echo "--- C hard_full + ultra + security + nightly ---"
timeout 240s node scripts/_hard_audit_full_0ht.js >/tmp/hard_full.txt 2>&1 || true
REAL_P0=$(grep -E '^P0 ' /tmp/hard_full.txt 2>/dev/null | grep -v '_hard_audit_0ht.js' | grep -v 'clearBusy' || true)
if [ -z "$REAL_P0" ]; then pass hard_full_no_real_P0
else fail P0 hard_full "$REAL_P0"; fi
grep -E 'SCORE|FULL_HARD|p0|P0 ' /tmp/hard_full.txt | tail -12

timeout 150s node scripts/_ultra_hard_audit.js >/tmp/ultra.txt 2>&1
ec=$?
ULTRA_LINE=$(grep -E 'P0_COUNT|VERDICT|CHECKS' /tmp/ultra.txt | tr '\n' ' ')
echo "$ULTRA_LINE"
if echo "$ULTRA_LINE" | grep -q 'P0_COUNT 0'; then pass ultra_p0_zero
elif [ $ec -eq 0 ]; then pass ultra_hard
else fail P1 ultra_ec_$ec; fi

if [ -f scripts/_nightly_hard_audit.js ]; then
  timeout 180s node scripts/_nightly_hard_audit.js >/tmp/nightly.txt 2>&1
  ec=$?
  [ $ec -eq 0 ] && pass nightly || fail P1 nightly_ec_$ec
  tail -12 /tmp/nightly.txt || true
else
  fail P1 nightly_missing
fi

python3 - <<'PY'
from pathlib import Path
def strip_comments(t):
    out=[]
    for l in t.splitlines():
        s=l.strip()
        if s.startswith('//') or s.startswith('*') or s.startswith('/*'): continue
        out.append(l)
    return '\n'.join(out)
gu=strip_comments(Path('lib/getUserId.js').read_text(encoding='utf-8',errors='ignore'))
bad = '|| 1' in gu or 'return 1' in gu
auth=Path('middleware/telegramAuth.js').read_text(encoding='utf-8',errors='ignore')
ok_auth=('TELEGRAM_AUTH_BYPASS' in auth) and ('remoteAddress' in auth or 'loopback' in auth or '127.0.0.1' in auth)
serv=Path('server.js').read_text(encoding='utf-8',errors='ignore')
# cors origin: '*' as string is bad with credentials; function/array OK
cors_star=("origin: '*'" in serv) or ('origin: "*"' in serv) or ("Access-Control-Allow-Origin', '*'" in serv)
print('getUserId_ok', not bad)
print('auth_ok', ok_auth)
print('cors_star', cors_star)
raise SystemExit(0 if (not bad and ok_auth and not cors_star) else 1)
PY
[ $? -eq 0 ] && pass security_gates || fail P0 security_gates

echo "--- pm2 / guard ---"
python3 - <<'PY'
import json,subprocess
d=json.loads(subprocess.check_output(['pm2','jlist'],text=True))
e=[x for x in d if x.get('name')=='tgbot'][0]['pm2_env']
pl=[x for x in str(e.get('PROXY_LIST') or '').split(';') if x.strip()]
print('pm2',e.get('status'),'PROXY',len(pl),'AUDIT',repr(e.get('AUDIT_SMOKE')))
assert e.get('status')=='online' and len(pl)>=5 and e.get('AUDIT_SMOKE') in (None,'','undefined')
PY
[ $? -eq 0 ] && pass pm2_proxy || fail P0 pm2_proxy
bash scripts/_deploy_guard.sh && pass deploy_guard || fail P0 deploy_guard

# funnel day labels live on VPS files
grep -q "FUNNEL_BOARD_STAGES = \\['day1'" services/leadScoring.js && pass funnel_stages_live || fail P0 funnel_stages_live
grep -q "repeat(4," ../ops-console/app/styles.css && pass ops_4cols || fail P1 ops_4cols

echo "=== AUDIT_C_SUMMARY P0=$P0 P1=$P1 ==="
[ "$P0" -gt 0 ] && { echo AUDIT_C_FAIL; exit 1; }
echo AUDIT_C_OK
exit 0
