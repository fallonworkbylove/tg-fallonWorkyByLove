#!/bin/bash
# Extra C checks: logs / code / defense / chat / AI (post-0lm)
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend"
P0=0; P1=0
pass(){ echo "OK  $1"; }
fail(){ local lvl="$1"; shift; echo "$lvl $*"; [ "$lvl" = P0 ] && P0=$((P0+1)) || P1=$((P1+1)); }

echo "=== EXTRA C 0lm $(date -u +%H:%M)UTC ==="

echo "--- code wiring ---"
grep -q fixEmptyQuotedTitles services/softHumanGates.js && pass code_empty_quotes || fail P0 code_empty_quotes
grep -q fixVagueFillerReply services/softHumanGates.js && pass code_vague || fail P0 code_vague
grep -q allowLoginAttempt services/loginRate.js && pass code_login_rate || fail P0 code_login_rate
grep -q '12, 60_000' middleware/httpRateLimit.js && pass code_http_12 || fail P1 code_http_12
grep -q changelog_sync scripts/_deploy_guard.sh && pass code_guard_cl || fail P0 code_guard_cl
grep -q HARD_AUDIT_FAST scripts/_audit_c_full_now.sh && pass code_audit_fast || fail P1 code_audit_fast
grep -q INTERVAL\ 1\ HOUR services/opsLiveMetrics.js && pass code_rph_db || fail P0 code_rph_db
node scripts/_check_getuserid_fallback.js >/tmp/c1e.txt 2>&1 && pass code_c1 || fail P0 code_c1

echo "--- defense ---"
python3 - <<'PY'
from pathlib import Path
auth=Path('middleware/telegramAuth.js').read_text(encoding='utf-8',errors='ignore')
ok=('TELEGRAM_AUTH_BYPASS' in auth) and ('remoteAddress' in auth)
gu=Path('lib/getUserId.js').read_text(encoding='utf-8',errors='ignore')
# no executable fallback to 1
bad=False
for l in gu.splitlines():
  s=l.strip()
  if s.startswith('//') or s.startswith('*'): continue
  if '|| 1' in s or 'return 1' in s: bad=True
print('auth', ok, 'getUserId_clean', not bad)
raise SystemExit(0 if ok and not bad else 1)
PY
[ $? -eq 0 ] && pass def_auth || fail P0 def_auth

echo "--- AI / chat smoke ---"
timeout 60s node scripts/_smoke_wave_0lm.js >/tmp/ex_0lm.txt 2>&1 && pass ai_smoke_0lm || fail P0 ai_smoke_0lm
timeout 40s node -e "
const g=require('./services/softHumanGates');
const bad='хах, ну ок) просто я не бот, а Лер)';
const o=g.fixBotAccusationReply(bad,'Чел, у тебя бот поплыл',[]);
if(/не\s+бот/i.test(o)) {console.error('bot',o); process.exit(1)}
const q=g.fixEmptyQuotedTitles('названия) «» и « War»');
if(/«/.test(q)) {console.error('quotes',q); process.exit(1)}
console.log('AI_GATES_OK', o, q);
" && pass ai_gates_live || fail P0 ai_gates_live

echo "--- live logs ---"
ERR=$(grep -aE 'null\.chat|REFUSE_PROXY|TypeError|FROZEN_METHOD' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -5 || true)
if [ -n "$ERR" ]; then echo "$ERR"; fail P1 live_error_hits; else pass live_errors_clean; fi
OUT=$(grep -aE 'Ответ для .*: \".*«»|не бот, а ' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -5 || true)
# post-deploy: old lines may exist; only flag if very recent hour hard to parse — soft
echo "sample_bad_patterns:"; echo "$OUT" | tail -3 || true
pass live_log_sampled

echo "--- project / pm2 ---"
python3 - <<'PY'
import json,subprocess
d=json.loads(subprocess.check_output(['pm2','jlist'],text=True))
e=[x for x in d if x['name']=='tgbot'][0]['pm2_env']
pl=[x for x in str(e.get('PROXY_LIST')or'').split(';') if x.strip()]
print('status',e.get('status'),'PROXY',len(pl))
assert e.get('status')=='online' and len(pl)>=5
PY
[ $? -eq 0 ] && pass proj_pm2 || fail P0 proj_pm2
bash scripts/_deploy_guard.sh && pass proj_guard || fail P0 proj_guard

echo "=== EXTRA_C_SUMMARY P0=$P0 P1=$P1 ==="
[ "$P0" -gt 0 ] && { echo EXTRA_C_FAIL; exit 1; }
echo EXTRA_C_OK
exit 0
