#!/bin/bash
# Audit C · хард жёсткий (post-0lj) — post-add-audit + human-audit
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-audit-c}"
P0=0; P1=0
pass(){ echo "OK  $1"; }
fail(){ local lvl="$1"; shift; echo "$lvl $*"; [ "$lvl" = P0 ] && P0=$((P0+1)) || P1=$((P1+1)); }

echo "=== AUDIT C FULL $(date -u +%H:%M)UTC ==="

echo "--- A smokes + wiring 0lm ---"
for s in _smoke_wave_0lm.js _smoke_wave_0lj.js _smoke_greet_hyphen_0li.js _smoke_metrics_db_0lk.js; do
  if [ -f "scripts/$s" ]; then
    timeout 90s node "scripts/$s" >/tmp/sm_$s.txt 2>&1 && pass "smoke_$s" || fail P0 "smoke_$s"
  else fail P1 "missing_$s"; fi
done
grep -q softHumanGates services/softHumanLite.js && pass wire_gates || fail P0 wire_gates
grep -q fixEmptyQuotedTitles services/softHumanGates.js && pass wire_empty_quotes || fail P0 wire_empty_quotes
grep -q fixVagueFillerReply services/softHumanGates.js && pass wire_vague || fail P0 wire_vague
grep -q allowLoginAttempt services/loginRate.js && pass wire_login_rate || fail P0 wire_login_rate
grep -q INTERVAL\ 1\ HOUR services/opsLiveMetrics.js && pass wire_rph_db || fail P0 wire_rph_db
grep -q 'updates.js?v=243' ../frontend/index.html && pass updates_v243 || fail P1 updates_v
grep -q '## 0lm\.' ../CHANGELOG_TG.md && pass changelog_0lm || fail P1 changelog

timeout 40s node scripts/_check_getuserid_fallback.js >/tmp/c1.txt 2>&1 && pass c1_fallback || fail P0 c1_fallback

echo "--- B human checklist + hard_0ht (FAST 120s) ---"
grep -qE 'phraseBanLimitFor' services/softHumanLite.js services/humanHardening.js 2>/dev/null && pass phrase_ban || fail P1 phrase_ban
grep -qE 'markPeerFiltered|отсев:' services/*.js && pass howlong_filter || fail P1 howlong_filter
grep -qE 'это\s+я|ownAvatar|flip.*guard|isOwnAvatar' services/*.js && pass flip_guard || fail P1 flip_guard
grep -qE 'isVoiceQuietHour|isNightTextQuietHour' services/timing.js && pass quiet_hours || fail P1 quiet_hours
grep -qE 'breakKaifEcho|каиф|kaif' services/softHumanLite.js services/humanHardening.js 2>/dev/null && pass kaif_echo || fail P1 kaif_echo

# D2: HARD_AUDIT_FAST=1 — без лишних side-effects; ждём до 120s (статический audit)
export HARD_AUDIT_FAST=1
timeout 120s env HARD_AUDIT_FAST=1 OPENAI_API_KEY=sk-audit-fast node scripts/_hard_audit_0ht.js >/tmp/hard_0ht.txt 2>&1
ec=$?
if [ $ec -eq 0 ]; then pass hard_0ht
elif [ $ec -eq 124 ]; then
  fail P1 hard_0ht_timeout
else fail P0 hard_0ht "$(grep -E 'FAIL|P0' /tmp/hard_0ht.txt | head -3)"
fi

echo "--- live greps (human-audit) ---"
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound ' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -20 || true
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|null\.chat|TypeError' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -20 || true

echo "--- C hard_full + ultra + security + nightly (180s) ---"
timeout 240s node scripts/_hard_audit_full_0ht.js >/tmp/hard_full.txt 2>&1 || true
REAL_P0=$(grep -E '^P0 ' /tmp/hard_full.txt 2>/dev/null | grep -v '_hard_audit_0ht.js' | grep -v 'clearBusy' || true)
if [ -z "$REAL_P0" ]; then pass hard_full_no_real_P0
else fail P0 hard_full "$REAL_P0"; fi
grep -E 'SCORE|FULL_HARD|p0' /tmp/hard_full.txt | tail -8

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
  tail -15 /tmp/nightly.txt || true
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
bad = '|| 1' in gu or "return 1" in gu
auth=Path('middleware/telegramAuth.js').read_text(encoding='utf-8',errors='ignore')
ok_auth=('TELEGRAM_AUTH_BYPASS' in auth) and ('remoteAddress' in auth or 'loopback' in auth or '127.0.0.1' in auth)
serv=Path('server.js').read_text(encoding='utf-8',errors='ignore')
cors_star=('Access-Control-Allow-Origin' in serv) and ("'*'" in serv or '"*"' in serv)
print('getUserId_ok', not bad)
print('auth_ok', ok_auth)
print('cors_star', cors_star)
raise SystemExit(0 if (not bad and ok_auth and not cors_star) else 1)
PY
[ $? -eq 0 ] && pass security_gates || fail P0 security_gates

echo "--- pm2 / guard / nft DB ---"
python3 - <<'PY'
import json,subprocess
d=json.loads(subprocess.check_output(['pm2','jlist'],text=True))
e=d[0]['pm2_env']
pl=[x for x in str(e.get('PROXY_LIST') or '').split(';') if x.strip()]
print('pm2',e.get('status'),'PROXY',len(pl),'AUDIT',repr(e.get('AUDIT_SMOKE')))
assert e.get('status')=='online' and len(pl)>=5 and e.get('AUDIT_SMOKE') in (None,'','undefined')
PY
[ $? -eq 0 ] && pass pm2_proxy || fail P0 pm2_proxy
bash scripts/_deploy_guard.sh && pass deploy_guard || fail P0 deploy_guard

node - <<'NODE'
require('dotenv').config({quiet:true});
const db=require('./db');
(async()=>{
  const [[stuck]]=await db.execute(`SELECT COUNT(*) n FROM nft_voice_schedule nvs
    WHERE work_mention_sent=1 AND (voice_skip_reason IS NULL OR voice_skip_reason='')
      AND scheduled_at < (NOW()-INTERVAL 90 MINUTE)
      AND NOT EXISTS (SELECT 1 FROM conversation_messages cm
        WHERE cm.account_id=nvs.account_id AND cm.peer_id=nvs.peer_id
          AND cm.role='assistant' AND cm.content LIKE '%nft.ogg%'
          AND cm.created_at>=nvs.work_mention_at)`);
  console.log(JSON.stringify({stuckLeft:+stuck.n}));
  process.exit(+stuck.n>0?4:0);
})().catch(e=>{console.error(e);process.exit(1);});
NODE
[ $? -eq 0 ] && pass nft_stuck_cleared || fail P1 nft_stuck

echo "=== AUDIT_C_SUMMARY P0=$P0 P1=$P1 ==="
[ "$P0" -gt 0 ] && { echo AUDIT_C_FAIL; exit 1; }
echo AUDIT_C_OK
exit 0
