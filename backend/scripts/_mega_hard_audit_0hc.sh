#!/bin/bash
# Absolute hard audit snapshot — LoveRussian (OPS/miniapp/AI/proxy/logs/security)
set -u
BASE=/root/opt/tgbot/tg-miniapp-loverussian
OUT=/tmp/mega_hard_audit_0hc_$(date +%Y%m%d_%H%M%S).txt
exec > >(tee "$OUT") 2>&1
echo "=== MEGA HARD AUDIT $(date -Is) ==="
echo "OUT=$OUT"

cd "$BASE/backend" || exit 1

echo; echo "─── PM2 / PROXY ───"
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot']
print('tgbot_count', len(p))
if not p: raise SystemExit(0)
e=p[0]['pm2_env']
pl=(e.get('PROXY_LIST') or '')
opl=(e.get('OPENAI_PROXY_LIST') or '')
print('status', e.get('status'))
print('restarts', e.get('restart_time'))
print('uptime_ms', e.get('pm_uptime'))
print('pm2_PROXY_LEN', len([x for x in pl.split(';') if x.strip()]))
print('pm2_OPENAI_PROXY_LEN', len([x for x in opl.split(';') if x.strip()]))
print('has_OPENAI_KEY', bool(e.get('OPENAI_API_KEY')))
print('node', e.get('node_version') or e.get('exec_interpreter'))
PY

python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
def n(k):
  m=re.search(rf'^{k}=(.*)$',t,re.M)
  if not m: return 0
  return len([x for x in m.group(1).strip().split(';') if x.strip()])
print('env_PROXY_LEN', n('PROXY_LIST'))
print('env_OPENAI_PROXY_LEN', n('OPENAI_PROXY_LIST'))
# secrets exposure smell in repo paths
for name in ['ADMIN_CONSOLE_TOKEN','JWT_SECRET','SESSION']:
  m=re.search(rf'^{name}=(.+)$',t,re.M)
  print(f'env_has_{name}', bool(m and m.group(1).strip()))
PY

echo; echo "─── LIVE LOGS (out) ───"
for f in /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-out-1.log; do
  [ -f "$f" ] || continue
  echo "# $f"
  grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound |FROZEN|PEER_ID_INVALID|REFUSE_PROXY|TypeError|is not defined|OPENAI' "$f" 2>/dev/null | tail -30
done

echo; echo "─── LIVE LOGS (err) ───"
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|TypeError|is not defined|ECONNREFUSED|SocksClient|Unhandled|FATAL' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -40

echo; echo "─── HTTP SURFACE ───"
for u in \
  'https://loverussian.duckdns.org/' \
  'https://loverussian.duckdns.org/ops/' \
  'https://loverussian.duckdns.org/ops/styles.css?v=132' \
  'https://loverussian.duckdns.org/ops/ops-web-bridge.js' \
  'https://loverussian.duckdns.org/api/health' \
  'https://loverussian.duckdns.org/api/console' \
  'https://loverussian.duckdns.org/api/admin/console' \
  ; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 "$u" || echo ERR)
  echo "$code  $u"
done

echo; echo "─── NGINX /ops ───"
grep -n 'location /ops' /etc/nginx/sites-enabled/tgbot 2>/dev/null | head -10 || echo 'no nginx ops block'

echo; echo "─── STATIC WIRING ───"
grep -n 'opsQuality\|startSilenceScheduler\|softenFraudAdmissionReply\|ops-web-bridge\|activity-top' \
  "$BASE/backend/server.js" \
  "$BASE/backend/services/replyPipeline.js" \
  "$BASE/backend/services/objectionHandler.js" \
  "$BASE/ops-console/app/index.html" \
  2>/dev/null | head -40

echo; echo "─── CHANGELOG / UPDATES ───"
head -12 "$BASE/CHANGELOG_TG.md" 2>/dev/null
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
grep -n 'styles.css?v=' "$BASE/ops-console/app/index.html" | head -1
node -e "const u=require('fs').readFileSync('$BASE/frontend/updates.js','utf8'); const m=u.match(/title:\s*'([^']+)'/); console.log('top_update', m&&m[1])"

echo; echo "─── ACCOUNTS / AI ───"
node - <<'PY'
require('dotenv').config();
const db=require('./db');
(async()=>{
  const [[tot]]=await db.query(`SELECT COUNT(*) AS c FROM accounts`);
  const [[ai]]=await db.query(`SELECT COUNT(*) AS c FROM accounts WHERE is_autoreply_enabled=1`);
  const [[empty]]=await db.query(`SELECT COUNT(*) AS c FROM accounts WHERE prompt IS NULL OR TRIM(prompt)=''`);
  const [[sess]]=await db.query(`SELECT COUNT(*) AS c FROM accounts WHERE session_string IS NULL OR TRIM(session_string)=''`);
  console.log(JSON.stringify({accounts:tot.c, ai_on:ai.c, empty_prompt:empty.c, no_session:sess.c}));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
PY

echo; echo "─── SMOKES (subset) ───"
for s in \
  _smoke_fraud_role_0hc.js \
  _smoke_interest_hits_0gv.js \
  _smoke_human_hardening.js \
  _smoke_10of10_gates.js \
  _smoke_no_react_on_ask_0gs.js \
  ; do
  if [ -f "scripts/$s" ]; then
    echo ">> $s"
    timeout 45 node "scripts/$s" && echo "PASS $s" || echo "FAIL_OR_TIMEOUT $s"
  else
    echo "MISS $s"
  fi
done

echo; echo "─── HARD AUDIT SCRIPT ───"
if [ -f scripts/_nightly_hard_audit.js ]; then
  timeout 90 node scripts/_nightly_hard_audit.js && echo PASS_nightly || echo FAIL_nightly
else
  echo 'no _nightly_hard_audit.js'
fi
ls scripts/_hard_audit*.js 2>/dev/null | head -10

echo; echo "─── SECURITY SMELLS ───"
# public files that must not leak tokens
find "$BASE/ops-console" "$BASE/frontend" -name '*secret*' -o -name '*.env' 2>/dev/null | head -20
grep -RIn --include='*.js' --include='*.html' --include='*.json' -E 'ADMIN_CONSOLE_TOKEN\s*=\s*['\''\"][^'\''\"]+|sk-[A-Za-z0-9]{20,}' \
  "$BASE/ops-console/app" "$BASE/frontend" 2>/dev/null | head -20 || echo 'no obvious token literals in static'
# admin API without auth probe
echo 'probe admin without token:'
curl -sS -o /tmp/adm_probe.json -w 'HTTP=%{http_code}\n' --max-time 10 \
  -H 'Content-Type: application/json' \
  https://loverussian.duckdns.org/api/admin/accounts 2>/dev/null || true
head -c 200 /tmp/adm_probe.json 2>/dev/null; echo

echo; echo "─── RECENT OUTBOUND SAMPLE ───"
grep -aE 'outbound |Ответ для' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -25

echo; echo "=== AUDIT FILE $OUT ==="
