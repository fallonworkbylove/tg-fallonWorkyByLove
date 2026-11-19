#!/bin/bash
# Absolute hard audit post-0hi: ops/miniapp/ai/logs/proxy/security/gaps
set -uo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cd "$B/backend"
OUT=/tmp/audit_0hj_$(date +%Y%m%d_%H%M%S).txt
exec > >(tee "$OUT") 2>&1
echo "======== HARD ABSOLUTE AUDIT 0hj $(date -u +%Y-%m-%dT%H:%MZ) ========"

echo "===== 1. PM2 / NODE ====="
pm2 jlist | python3 -c '
import json,sys
j=json.load(sys.stdin)
p=[x for x in j if x["name"]=="tgbot"][0]
e=p["pm2_env"]
pl=(e.get("PROXY_LIST")or"")
oa=(e.get("OPENAI_PROXY_LIST")or"")
print({
  "status":e["status"],
  "restarts":e.get("restart_time"),
  "unstable":e.get("unstable_restarts"),
  "node":e.get("node_version"),
  "uptime_ms":p.get("pm_uptime") and (__import__("time").time()*1000-p["pm_uptime"]),
  "pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()]),
  "pm2_OPENAI_LEN":len([x for x in oa.split(";") if x.strip()]),
  "has_OPENAI_KEY":bool((e.get("OPENAI_API_KEY")or"").strip()),
  "has_ADMIN_TOKEN":bool((e.get("ADMIN_CONSOLE_TOKEN")or e.get("CONSOLE_TOKEN")or"").strip()),
})
'

echo "===== 2. ENV lens / secrets presence ====="
python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
def n(k):
  m=re.search(rf'^{k}=(.*)$',t,re.M)
  if not m: return 0
  return len([x for x in m.group(1).split(';') if x.strip()])
def has(k):
  m=re.search(rf'^{k}=(.+)$',t,re.M)
  return bool(m and m.group(1).strip() and m.group(1).strip() not in ('','changeme','TODO'))
print('env_PROXY_LEN', n('PROXY_LIST'))
print('env_OPENAI_PROXY_LEN', n('OPENAI_PROXY_LIST'))
for k in ('OPENAI_API_KEY','ADMIN_CONSOLE_TOKEN','CONSOLE_TOKEN','TELEGRAM_BOT_TOKEN','JWT_SECRET','SESSION_SECRET'):
  print(f'has_{k}', has(k))
PY

echo "===== 3. HTTP local surface ====="
for u in \
  'http://127.0.0.1:3000/health' \
  'http://127.0.0.1:3000/api/health' \
  'http://127.0.0.1:3000/' \
  'http://127.0.0.1:3000/ops/' \
  'http://127.0.0.1:3000/ops/index.html' \
  'http://127.0.0.1:3000/api/console' \
  'http://127.0.0.1:3000/api/admin' \
  'http://127.0.0.1:3000/api/admin/accounts' \
  'http://127.0.0.1:3000/api/accounts' \
  'http://127.0.0.1:3000/api/stats' \
  'http://127.0.0.1:3000/api/dashboard' \
  'http://127.0.0.1:3000/api/options'
 do
  code=$(curl -s -o /tmp/_aud_body -w '%{http_code}' --max-time 8 "$u" || echo ERR)
  bytes=$(wc -c </tmp/_aud_body 2>/dev/null || echo 0)
  echo "$code bytes=$bytes $u"
done

echo "===== 4. HTTPS public ====="
for u in \
  'https://loverussian.duckdns.org/health' \
  'https://loverussian.duckdns.org/' \
  'https://loverussian.duckdns.org/ops/' \
  'https://loverussian.duckdns.org/api/console' \
  'https://loverussian.duckdns.org/api/admin/accounts' \
  'https://ops-loverussian.duckdns.org/'
 do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$u" || echo ERR)
  echo "$code $u"
done

echo "===== 5. Frontend / OPS markers ====="
grep -n 'updates.js?v=' "$B/frontend/index.html" | head -2
echo -n 'frontend_title_0hi: '; grep -c 'тишинам\|silence\|Ночью\|токен' "$B/frontend/updates.js" || true
echo -n 'ops_title_0hi: '; grep -c 'тишинам\|silence\|Ночью\|токен' "$B/ops-console/app/updates.js" || true
head -40 "$B/frontend/updates.js" | sed -n '1,25p'
ls -la "$B/ops-console/app/styles.css" "$B/ops-console/app/app.js" 2>/dev/null | awk '{print $5,$9}'
grep -nE 'activity-top|max-width:\s*100%|OpsJsBridge|BAKED|consoleToken|localStorage' "$B/ops-console/app/styles.css" "$B/ops-console/app/app.js" 2>/dev/null | head -40
echo "--- APK / bridge ---"
find "$B" -iname '*OpsJsBridge*' -o -iname '*LoveRussian*OPS*' 2>/dev/null | head -20
grep -rnE 'BAKED|HARDCODED|CONSOLE_TOKEN\s*=\s*['\''\"][^'\''\"]+|ops-loverussian' "$B/android-ops" "$B/ops-apk" "$B/mobile" 2>/dev/null | head -30 || true

echo "===== 6. Wiring / night / silence / ops no-bake ====="
grep -n 'isNightTextQuietHour\|configureSilenceCatchup\|scheduleSilenceHeal\|silenceCatchup' \
  "$B/backend/services/timing.js" \
  "$B/backend/services/opsQuality.js" \
  "$B/backend/services/telegramClient.js" \
  "$B/backend/services/replyPipeline.js" \
  "$B/backend/server.js" 2>/dev/null | head -40
grep -nE 'expandBareStubOnQuestion|preferSilentReaction|lifeLag|explicitMedia' \
  "$B/backend/services/humanHardening.js" \
  "$B/backend/services/opsQuality.js" \
  "$B/backend/services/replyPipeline.js" 2>/dev/null | head -25
grep -nE 'OpsJsBridge|empty token|no.?bake|BAKED_TOKEN|getToken' \
  "$B/ops-console" "$B/android-ops" 2>/dev/null | head -20 || true

echo "===== 7. Smokes ====="
for s in \
  scripts/_smoke_antistub_silence_0hf.js \
  scripts/_smoke_human_hardening.js \
  scripts/_smoke_fraud_role_0hc.js \
  scripts/_smoke_silence_catchup_0hi.js \
  scripts/_smoke_night_text_0hi.js \
  scripts/_smoke_ops_nobake_0hi.js
 do
  if [ -f "$s" ]; then
    echo "-- $s --"
    OPENAI_API_KEY="${OPENAI_API_KEY:-sk-test}" node "$s" 2>&1 | tail -8
  else
    echo "MISSING $s"
  fi
done
node scripts/_hard_audit_0gc.js 2>&1 | tail -20 || echo HARD_0GC_FAIL
node scripts/_nightly_hard_audit.js 2>&1 | tail -15 || echo NIGHTLY_FAIL

echo "===== 8. DB: accounts / stubs / gaps / prompts ====="
node - <<'NODE'
require('dotenv').config();
const db = require('./db');
(async () => {
  const [[ai]] = await db.query('SELECT COUNT(*) c FROM accounts WHERE is_autoreply_enabled=1');
  const [[nos]] = await db.query("SELECT COUNT(*) c FROM accounts WHERE is_autoreply_enabled=1 AND (session IS NULL OR session='')");
  const [prompts] = await db.query(`
    SELECT id, name, CHAR_LENGTH(COALESCE(prompt,'')) plen
    FROM accounts WHERE is_autoreply_enabled=1 ORDER BY plen ASC LIMIT 12`);
  const [[stub24]] = await db.query(`
    SELECT COUNT(*) c FROM conversation_messages
    WHERE role='assistant' AND created_at>NOW()-INTERVAL 24 HOUR
      AND TRIM(content) REGEXP '^(ок|поняла|ясно|ага|угу|мм+|ну ок)[)\\]!?.]*$'`);
  const [[stub6]] = await db.query(`
    SELECT COUNT(*) c FROM conversation_messages
    WHERE role='assistant' AND created_at>NOW()-INTERVAL 6 HOUR
      AND TRIM(content) REGEXP '^(ок|поняла|ясно|ага|угу|мм+|ну ок)[)\\]!?.]*$'`);
  const [[gaps2h]] = await db.query(`
    SELECT COUNT(*) c FROM (
      SELECT cm.account_id, cm.peer_id
      FROM conversation_messages cm
      JOIN accounts a ON a.id=cm.account_id AND a.is_autoreply_enabled=1
      LEFT JOIN conversation_messages ca
        ON ca.account_id=cm.account_id AND ca.peer_id=cm.peer_id
       AND ca.role='assistant' AND ca.created_at>cm.created_at
      WHERE cm.role='user' AND cm.created_at>NOW()-INTERVAL 2 HOUR AND ca.id IS NULL
      GROUP BY cm.account_id, cm.peer_id
    ) t`);
  const [[gapsRead]] = await db.query(`
    SELECT COUNT(*) c FROM (
      SELECT cm.account_id, cm.peer_id
      FROM conversation_messages cm
      JOIN accounts a ON a.id=cm.account_id AND a.is_autoreply_enabled=1
      LEFT JOIN conversation_messages ca
        ON ca.account_id=cm.account_id AND ca.peer_id=cm.peer_id
       AND ca.role='assistant' AND ca.created_at>cm.created_at
      WHERE cm.role='user' AND cm.created_at>NOW()-INTERVAL 12 HOUR AND ca.id IS NULL
      GROUP BY cm.account_id, cm.peer_id
    ) t`);
  const [gapSamples] = await db.query(`
    SELECT cm.account_id, cm.peer_id, LEFT(cm.content,80) txt, cm.created_at
    FROM conversation_messages cm
    JOIN accounts a ON a.id=cm.account_id AND a.is_autoreply_enabled=1
    LEFT JOIN conversation_messages ca
      ON ca.account_id=cm.account_id AND ca.peer_id=cm.peer_id
     AND ca.role='assistant' AND ca.created_at>cm.created_at
    WHERE cm.role='user' AND cm.created_at>NOW()-INTERVAL 6 HOUR AND ca.id IS NULL
    ORDER BY cm.created_at DESC LIMIT 12`);
  console.log(JSON.stringify({
    ai_on: ai.c, no_session_ai: nos.c,
    stubs_24h: stub24.c, stubs_6h: stub6.c,
    open_gaps_2h: gaps2h.c, open_gaps_12h: gapsRead.c,
    short_prompts: prompts.map(p=>({id:p.id,name:p.name,plen:p.plen})),
    gap_samples: gapSamples,
  }, null, 2));
  process.exit(0);
})().catch(e=>{console.error(e); process.exit(1);});
NODE

echo "===== 9. Logs: human / AI / proxy / security ====="
echo "-- out: silence/heal/night/outbound --"
grep -aE 'silence.?heal|SilenceCatchup|night.?text|isNightText|ответил, сколько|отсев \+ архив|AI замолчал|Дайджест отсева|outbound |preferSilent|expandBareStub|life.?lag' \
  /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -35 || true
echo "-- out rotated --"
ls -lt /root/.pm2/logs/tgbot-out*.log 2>/dev/null | head -5
LATEST_ROT=$(ls -t /root/.pm2/logs/tgbot-out*.log 2>/dev/null | sed -n '2p')
if [ -n "${LATEST_ROT:-}" ]; then
  grep -aE 'silence.?heal|SilenceCatchup|AI замолчал|отсев \+ архив|outbound ' "$LATEST_ROT" 2>/dev/null | tail -20 || true
fi
echo "-- err: socks/openai/peer/frozen --"
grep -aE 'SocksClientError|invalid socks|Proxy connection|OPENAI|REFUSE_PROXY|PEER_ID_INVALID|FROZEN_METHOD|ECONNRESET|Unhandled|TypeError|access_hash' \
  /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -40 || true
echo "-- counts --"
python3 - <<'PY'
import pathlib,re
p=pathlib.Path('/root/.pm2/logs/tgbot-error.log')
t=p.read_text(encoding='utf-8',errors='ignore')[-800000:] if p.exists() else ''
for pat in ['SocksClientError','PEER_ID_INVALID','FROZEN_METHOD','OPENAI','TypeError','access_hash','entity']:
  print(pat, len(re.findall(pat,t,re.I)))
o=pathlib.Path('/root/.pm2/logs/tgbot-out.log')
ot=o.read_text(encoding='utf-8',errors='ignore')[-900000:] if o.exists() else ''
for pat in [r'это\s+я', r'бород', r'AI замолчал', r'отсев \+ архив', r'SilenceCatchup|silence.?heal', r'night text|NightText|skip.*night']:
  print('OUT', pat, len(re.findall(pat,ot,re.I)))
PY

echo "===== 10. CORS / nginx / ops origin ====="
nginx -T 2>/dev/null | grep -nE 'server_name|location /ops|ops-loverussian|Access-Control|proxy_pass' | head -40 || true
ls /etc/nginx/sites-enabled/ 2>/dev/null
grep -rnE 'cors|Access-Control|ops-loverussian|ALLOWED_ORIGIN' "$B/backend" --include='*.js' 2>/dev/null | head -25 || true

echo "===== 11. Code security quick ====="
grep -rnE 'eval\(|child_process|exec\(|dangerouslySetInnerHTML|password\s*[:=]|api[_-]?key\s*[:=]\s*['\''\"]sk-' \
  "$B/backend/routes" "$B/frontend" "$B/ops-console/app" 2>/dev/null | head -30 || true
grep -nE 'telegramAuth|debugUser|requireAuth|consoleToken' \
  "$B/backend/middleware"/*.js "$B/backend/routes/adminConsole.js" 2>/dev/null | head -30 || true

echo "===== 12. Proxy live probe (sample 5) ====="
python3 - <<'PY'
import os,re,socket,ssl,urllib.request
from pathlib import Path
# just report lens; live socks probe may be heavy — sample via env already in pm2
print('skip_full_socks_probe_use_lens_above')
PY
# quick openai via existing probe if present
if [ -f scripts/_probe_ai_alive_now.js ]; then
  timeout 45 node scripts/_probe_ai_alive_now.js 2>&1 | tail -15 || echo AI_PROBE_TIMEOUT
fi

echo "===== 13. Visual / CSS smell ====="
python3 - <<'PY'
from pathlib import Path
css=Path('/root/opt/tgbot/tg-miniapp-loverussian/ops-console/app/styles.css').read_text(errors='ignore')
fe=Path('/root/opt/tgbot/tg-miniapp-loverussian/frontend')
print('ops_css_bytes', len(css))
print('activity_top', 'activity-top' in css)
print('phone_max100', 'max-width: 100%' in css or 'max-width:100%' in css)
# miniapp index
idx=(fe/'index.html').read_text(errors='ignore')
print('miniapp_has_viewport', 'viewport' in idx)
print('updates_v', [l for l in idx.splitlines() if 'updates.js?v=' in l][:1])
PY

echo "======== AUDIT_0HJ_DONE file=$OUT ========"
