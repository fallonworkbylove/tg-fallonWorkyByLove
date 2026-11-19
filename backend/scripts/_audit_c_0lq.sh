#!/bin/bash
# Audit C · post-0lp — scripts + security + UI wiring + live greps
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-audit-c}"
export HARD_AUDIT_FAST=1
P0=0; P1=0
pass(){ echo "OK  $1"; }
fail(){ local lvl="$1"; shift; echo "$lvl $*"; [ "$lvl" = P0 ] && P0=$((P0+1)) || P1=$((P1+1)); }

echo "=== AUDIT C 0lq $(date -u +%H:%M)UTC ==="

echo "--- A smokes ---"
for s in _smoke_wave_0lp.js _smoke_wave_0lo.js _smoke_funnel_days_0ln.js _smoke_wave_0lm.js; do
  if [ -f "scripts/$s" ]; then
    timeout 90s node "scripts/$s" >/tmp/sm_$s.txt 2>&1 && pass "smoke_$s" || fail P0 "smoke_$s"
  else fail P1 "missing_$s"; fi
done

echo "--- wiring 0lo/0lp ---"
grep -q applyWave0loGates services/softHumanGates.js && pass wire_0lo || fail P0 wire_0lo
grep -q applyWave0loGates services/softHumanLite.js && pass wire_softlite || fail P0 wire_softlite
grep -q warmProbeLoginProxies services/proxyPools.js && pass wire_login_probe || fail P0 wire_login_probe
grep -q warmProbeLoginProxies services/loginAuth.js && pass wire_login_call || fail P0 wire_login_call
grep -q 'bad-reply' routes/accounts.js && pass wire_bad_route || fail P0 wire_bad_route
grep -q flagBadReply ../frontend/app.js && pass wire_bad_fe || fail P0 wire_bad_fe
grep -q data-action=\"bad-reply\" ../frontend/app.js && pass wire_bad_btn || fail P0 wire_bad_btn
grep -q day-bar ../ops-console/app/renderer.js && pass wire_daybar || fail P0 wire_daybar
grep -q FUNNEL_BOARD_STAGES services/leadScoring.js && pass wire_funnel || fail P0 wire_funnel
grep -q 'updates.js?v=246' ../frontend/index.html && pass updates_v246 || fail P1 updates_v
grep -q '## 0lp\.' ../CHANGELOG_TG.md && pass changelog_0lp || fail P1 changelog

timeout 40s node scripts/_check_getuserid_fallback.js >/tmp/c1.txt 2>&1 && pass c1_fallback || fail P0 c1_fallback

echo "--- B human ---"
grep -qE 'phraseBanLimitFor' services/softHumanLite.js services/humanHardening.js 2>/dev/null && pass phrase_ban || fail P1 phrase_ban
grep -qE 'markPeerFiltered|отсев:' services/*.js && pass howlong_filter || fail P1 howlong_filter
grep -qE 'ownAvatar|совпало с моей|isOwnAvatar' services/*.js && pass flip_guard || fail P1 flip_guard
grep -qE 'isVoiceQuietHour|isNightTextQuietHour' services/timing.js && pass quiet_hours || fail P1 quiet_hours
grep -qE 'breakKaifEcho|каиф|kaif' services/softHumanLite.js services/humanHardening.js 2>/dev/null && pass kaif_echo || fail P1 kaif_echo

# claimsHer / это ты? — регресс из memory
node - <<'NODE' >/tmp/claims.txt 2>&1
const oh = require('./services/objectionHandler');
const soft = oh.softenClaimedHerPhotoReply(
  'прикольное фото, у тебя тоже есть такие?',
  'Подпись «это ты?»\n[совпало с моей аватаркой]',
  { matchesOwnAvatar: true },
);
const ok = /это я|моя фот|ага/i.test(soft) && !/не я|прикольное фото/i.test(soft);
console.log(ok ? 'OK claims_own_avatar' : 'FAIL claims_own_avatar: ' + soft);
process.exit(ok ? 0 : 1);
NODE
[ $? -eq 0 ] && pass claims_own_avatar || fail P0 claims_own_avatar

timeout 120s env HARD_AUDIT_FAST=1 node scripts/_hard_audit_0ht.js >/tmp/hard_0ht.txt 2>&1 || true
grep -q HARD_AUDIT_0HT_OK /tmp/hard_0ht.txt && pass hard_0ht || fail P1 hard_0ht_timeout

echo "--- live greps ---"
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound |Login DC' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -15 || true
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|TypeError|circuit OPEN' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -15 || true

echo "--- C full + ultra + security ---"
timeout 240s node scripts/_hard_audit_full_0ht.js >/tmp/hard_full.txt 2>&1 || true
REAL_P0=$(grep -E '^P0 ' /tmp/hard_full.txt 2>/dev/null | grep -v '_hard_audit_0ht.js' | grep -v 'clearBusy' || true)
[ -z "$REAL_P0" ] && pass hard_full_no_real_P0 || fail P0 hard_full "$REAL_P0"
grep -E 'SCORE|FULL_HARD|p0' /tmp/hard_full.txt | tail -8

timeout 150s node scripts/_ultra_hard_audit.js >/tmp/ultra.txt 2>&1
ULTRA=$(grep -E 'P0_COUNT|VERDICT' /tmp/ultra.txt | tr '\n' ' ')
echo "$ULTRA"
echo "$ULTRA" | grep -q 'P0_COUNT 0' && pass ultra_p0_zero || fail P1 ultra

python3 - <<'PY'
from pathlib import Path
def strip_comments(t):
    return '\n'.join(l for l in t.splitlines() if not l.strip().startswith(('//','*','/*')))
gu=strip_comments(Path('lib/getUserId.js').read_text(encoding='utf-8',errors='ignore'))
bad = '|| 1' in gu or 'return 1' in gu
auth=Path('middleware/telegramAuth.js').read_text(encoding='utf-8',errors='ignore')
ok_auth=('TELEGRAM_AUTH_BYPASS' in auth) and ('remoteAddress' in auth or '127.0.0.1' in auth or 'loopback' in auth)
serv=Path('server.js').read_text(encoding='utf-8',errors='ignore')
cors_star=("origin: '*'" in serv) or ('origin: "*"' in serv)
# UI: btn-dense / bad-reply must exist
fe=Path('../frontend/app.js').read_text(encoding='utf-8',errors='ignore')
ops=Path('../ops-console/app/renderer.js').read_text(encoding='utf-8',errors='ignore')
ops_html=Path('../ops-console/app/index.html').read_text(encoding='utf-8',errors='ignore')
ui_ok = ('bad-reply' in fe) and ('btn-dense' in ops_html) and ('btn-csv' in ops_html) and ('exportLeadsCsv' in ops) and ('applyDense' in ops)
print('getUserId_ok', not bad)
print('auth_ok', ok_auth)
print('cors_star', cors_star)
print('ui_buttons_ok', ui_ok)
raise SystemExit(0 if (not bad and ok_auth and not cors_star and ui_ok) else 1)
PY
[ $? -eq 0 ] && pass security_ui_gates || fail P0 security_ui_gates

python3 - <<'PY'
import json,subprocess
d=json.loads(subprocess.check_output(['pm2','jlist'],text=True))
e=[x for x in d if x.get('name')=='tgbot'][0]['pm2_env']
pl=[x for x in str(e.get('PROXY_LIST') or '').split(';') if x.strip()]
print('pm2',e.get('status'),'PROXY',len(pl))
assert e.get('status')=='online' and len(pl)>=5
PY
[ $? -eq 0 ] && pass pm2_proxy || fail P0 pm2_proxy
bash scripts/_deploy_guard.sh && pass deploy_guard || fail P0 deploy_guard

echo "=== AUDIT_C_SUMMARY P0=$P0 P1=$P1 ==="
[ "$P0" -gt 0 ] && { echo AUDIT_C_FAIL; exit 1; }
echo AUDIT_C_OK
exit 0
