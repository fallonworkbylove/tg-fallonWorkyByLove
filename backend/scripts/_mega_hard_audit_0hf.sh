#!/bin/bash
# Absolute hard audit after 0hf
set -uo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cd "$B/backend"
echo "======== HARD AUDIT 0hf $(date -u +%Y-%m-%dT%H:%MZ) ========"

echo "--- PM2 ---"
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];pl=e.get("PROXY_LIST")or"";oa=e.get("OPENAI_PROXY_LIST")or"";print({"status":e["status"],"restarts":e.get("restart_time"),"node":e.get("node_version"),"pm2_PROXY_LEN":len([x for x in pl.split(";")if x.strip()]),"pm2_OPENAI_LEN":len([x for x in oa.split(";")if x.strip()])})'

echo "--- ENV lens ---"
python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
def n(k):
  m=re.search(rf'^{k}=(.*)$',t,re.M)
  if not m: return 0
  return len([x for x in m.group(1).split(';') if x.strip()])
print('env_PROXY_LEN', n('PROXY_LIST'))
print('env_OPENAI_PROXY_LEN', n('OPENAI_PROXY_LIST'))
PY

echo "--- HTTP surface ---"
for u in \
  'http://127.0.0.1:3000/health' \
  'http://127.0.0.1:3000/' \
  'http://127.0.0.1:3000/ops/' \
  'http://127.0.0.1:3000/api/console' \
  'http://127.0.0.1:3000/api/admin/accounts'
 do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$u" || echo ERR)
  echo "$code $u"
done

echo "--- frontend/ops markers ---"
grep -n 'updates.js?v=' "$B/frontend/index.html" | head -1
grep -c 'Меньше пустых' "$B/frontend/updates.js" || true
grep -c 'Меньше пустых' "$B/ops-console/app/updates.js" || true
ls -la "$B/ops-console/app/styles.css" | awk '{print $5,$9}'
grep -n 'activity-top\|max-width: 100%' "$B/ops-console/app/styles.css" | head -5

echo "--- wiring smoke ---"
node scripts/_smoke_antistub_silence_0hf.js || echo SMOKE_ANTISTUB_FAIL
node scripts/_smoke_human_hardening.js 2>/dev/null | tail -5 || echo SMOKE_HH_FAIL
node scripts/_smoke_fraud_role_0hc.js 2>/dev/null | tail -5 || true

echo "--- stubs/gaps live ---"
node scripts/_probe_audit_gaps_stubs.js 2>/dev/null | head -40

echo "--- socks errors last 200 ---"
grep -aE 'SocksClientError|invalid socks|Proxy connection timed' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -15 || true
ERR_N=$(grep -acE 'SocksClientError|invalid socks' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -1 || echo 0)
echo "socks_error_lines_total≈$ERR_N"

echo "--- outbound sample ---"
grep -aE 'outbound media|leak=|Ответ для' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -20 || true

echo "--- AI silence / accounts ---"
node -e "
require('dotenv').config();
const db=require('./db');
(async()=>{
  const [a]=await db.query('SELECT COUNT(*) c FROM accounts WHERE is_autoreply_enabled=1');
  const [s]=await db.query(\"SELECT COUNT(*) c FROM accounts WHERE is_autoreply_enabled=1 AND (session IS NULL OR session='')\");
  const [[g]]=await db.query(\`SELECT COUNT(*) c FROM (
    SELECT a.id FROM accounts a
    JOIN conversation_messages cm ON cm.account_id=a.id AND cm.role='user' AND cm.created_at>(NOW()-INTERVAL 2 HOUR)
    LEFT JOIN conversation_messages ca ON ca.account_id=a.id AND ca.peer_id=cm.peer_id AND ca.role='assistant' AND ca.created_at>cm.created_at
    WHERE a.is_autoreply_enabled=1 AND ca.id IS NULL GROUP BY a.id, cm.peer_id
  ) t\`);
  console.log({ai_on:a[0].c, no_session_ai:s[0].c, open_unanswered_2h:g.c});
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
" 2>/dev/null

echo "--- code gates ---"
grep -n 'expandBareStubOnQuestion' services/humanHardening.js | head -2
grep -n 'Только явные кивки' services/opsQuality.js | head -1
grep -n 'лайф' services/humanIdeas10.js | head -2
grep -n 'explicitMediaRequest && !mediaType' services/replyPipeline.js | head -2 || true
grep -c 'softenFraudAdmissionReply' services/objectionHandler.js || true

echo "======== AUDIT_0HF_DONE ========"
