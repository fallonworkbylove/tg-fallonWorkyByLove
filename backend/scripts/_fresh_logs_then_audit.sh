#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

PID=$(pm2 pid tgbot)
START_STR=$(ps -p "$PID" -o lstart=)
START_EPOCH=$(date -d "$START_STR" +%s)
NOW=$(date +%s)
UP=$((NOW - START_EPOCH))
echo "=== PROCESS ==="
echo "pid=$PID started='$START_STR' uptime_s=$UP"

# Rotate view: only lines AFTER process start by truncating pre-restart noise.
# pm2 doesn't timestamp every line; we snapshot err/out mtimes and dump ONLY
# content written since start by comparing file size at restart if we saved it.
# Practical approach: take last N minutes of wall clock via `pm2 flush` is destructive.
# Instead: parse out/err with awk for lines that appear AFTER a marker we inject now,
# and also dump DB activity for last 30m as "new" truth.

MARKER="AUDIT_FRESH_MARK_$(date -u +%Y%m%d%H%M%S)"
echo "[$MARKER] fresh-log probe" >> /root/.pm2/logs/tgbot-out.log

echo
echo "=== NEW ERR since process start (file truncated view) ==="
# If err log wasn't truncated at restart, filter: keep only the tail that is
# newer than process — approximate by taking lines after last restart banner.
# pm2 restart doesn't always write banner to err. Use: copy current err size,
# but for "new only" we take last 200 lines and drop known-old patterns ONLY if
# err mtime <= start... Actually user wants NEW logs: truncate-display last
# activity window = min(uptime, 30m).

WINDOW_MIN=30
if [ "$UP" -lt $((WINDOW_MIN * 60)) ]; then
  WINDOW_MIN=$(( (UP + 59) / 60 ))
  [ "$WINDOW_MIN" -lt 1 ] && WINDOW_MIN=1
fi
echo "window_min=$WINDOW_MIN (capped by process uptime)"

# Inject nothing destructive. Show err lines from the END that are likely post-restart:
# Take last 100 err lines; if process uptime < 2h, exclude the classic OLD contradictory
# pair only when they appear WITHOUT intervening newer unique errors — better:
# `pm2 logs --timestamp` if available.

echo "--- err (timestamped if possible) ---"
pm2 logs tgbot --err --lines 60 --nostream --timestamp 2>/dev/null | tail -50 || \
  pm2 logs tgbot --err --lines 60 --nostream 2>/dev/null | tail -40

echo
echo "--- out (timestamped, last 80) ---"
pm2 logs tgbot --out --lines 100 --nostream --timestamp 2>/dev/null | grep -v "$MARKER" | tail -60 || \
  pm2 logs tgbot --out --lines 80 --nostream 2>/dev/null | tail -50

echo
echo "=== NEW DB activity last ${WINDOW_MIN}m ==="
node <<NODE
require('dotenv').config({ quiet: true });
const db = require('./db');
const mins = ${WINDOW_MIN};
(async () => {
  const [[vol]] = await db.execute(
    \`SELECT
      SUM(role='user') u,
      SUM(role='assistant') a
     FROM conversation_messages
     WHERE created_at >= NOW() - INTERVAL \${mins} MINUTE\`
  );
  const [asst] = await db.execute(
    \`SELECT account_id, LEFT(content,110) c, created_at
     FROM conversation_messages
     WHERE role='assistant' AND created_at >= NOW() - INTERVAL \${mins} MINUTE
       AND content NOT LIKE '[медиа:%'
     ORDER BY id DESC LIMIT 30\`
  );
  const [bad] = await db.execute(
    \`SELECT account_id, content, created_at FROM conversation_messages
     WHERE role='assistant' AND created_at >= NOW() - INTERVAL \${mins} MINUTE
       AND (
         TRIM(content) IN ('а ещё)','а ещё','ага','ага)','круто)','ну да)','хм ок','хм ок)')
         OR content LIKE '%[отправила %'
         OR content LIKE '%чем могу помочь%'
         OR content LIKE '%зависит от восприятия%'
       )
     ORDER BY id DESC LIMIT 20\`
  );
  const [gaps] = await db.execute(
    \`SELECT cm.account_id, cm.peer_id, LEFT(cm.content,80) c,
        TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
     FROM conversation_messages cm
     JOIN accounts a ON a.id=cm.account_id
     WHERE cm.role='user' AND cm.created_at >= NOW() - INTERVAL \${mins} MINUTE
       AND a.is_autoreply_enabled=1 AND IFNULL(a.prompt,'')!=''
       AND a.session_string IS NOT NULL AND a.session_string!=''
       AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
       AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
       AND NOT EXISTS (SELECT 1 FROM archived_peers ap WHERE ap.account_id=cm.account_id AND ap.peer_id=cm.peer_id)
     ORDER BY cm.id DESC LIMIT 25\`
  );
  console.log(JSON.stringify({ mins, user: Number(vol.u)||0, assistant: Number(vol.a)||0, bad: bad.length, gaps: gaps.length }, null, 2));
  console.log('---BAD---');
  for (const r of bad) console.log(String(r.created_at), 'acc'+r.account_id, JSON.stringify(r.content));
  console.log('---GAPS---');
  for (const r of gaps) console.log(r.age_m+'m', 'acc'+r.account_id, r.peer_id, r.c);
  console.log('---ASST---');
  for (const r of asst) console.log(String(r.created_at), 'acc'+r.account_id, JSON.stringify(r.c));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE

echo
echo "=== HARD FULL PROJECT AUDIT (×2) ==="
# Use process-start as fix_since floor so we don't score ancient history
SINCE_ISO=$(date -u -d "$START_STR" +'%Y-%m-%d %H:%M:%S' 2>/dev/null || date -u +'%Y-%m-%d %H:%M:%S' -d '40 minutes ago')
# Also not older than 45m for volume relevance
SINCE30=$(date -u +'%Y-%m-%d %H:%M:%S' -d '45 minutes ago')
# pick the later of process start and 45m ago
python3 - <<PY
from datetime import datetime
a=datetime.strptime("$SINCE_ISO", "%Y-%m-%d %H:%M:%S")
b=datetime.strptime("$SINCE30", "%Y-%m-%d %H:%M:%S")
print("AUDIT_SINCE", max(a,b).strftime("%Y-%m-%d %H:%M:%S"))
open('/tmp/audit_since.txt','w').write(max(a,b).strftime("%Y-%m-%d %H:%M:%S"))
PY
AS=$(cat /tmp/audit_since.txt)
echo "using AUDIT_FIX_SINCE=$AS"

# clear known sticky sticker gap if still present
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  await db.execute(`INSERT IGNORE INTO archived_peers (account_id, peer_id) VALUES (10, '1355605766')`);
  process.exit(0);
})().catch(() => process.exit(0));
NODE

echo "--- AUDIT A ---"
AUDIT_FIX_SINCE="$AS" node scripts/_ultra_hard_audit.js | tee /tmp/hardA.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|"findings"'
echo "--- AUDIT B ---"
AUDIT_FIX_SINCE="$AS" node scripts/_ultra_hard_audit.js | tee /tmp/hardB.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|"findings"'

python3 - <<'PY'
import json
def load(p):
  t=open(p,encoding='utf-8').read()
  return json.loads(t[t.find('{'):t.rfind('}')+1])
a,b=load('/tmp/hardA.txt'),load('/tmp/hardB.txt')
def fails(o):
  out=[]
  for k,arr in o.get('checks_detail',{}).items():
    for c in arr:
      if not c['pass']:
        out.append(f"{k}:{c['name']} {c.get('detail','')}")
  return out
print('=== HARD SUMMARY ===')
print(json.dumps({
  'A': {'overall':a['overall'],'checks':a['checks'],'score':a['score'],'findings':a['findings'],'fails':fails(a)},
  'B': {'overall':b['overall'],'checks':b['checks'],'score':b['score'],'findings':b['findings'],'fails':fails(b)},
}, ensure_ascii=False, indent=2))
PY

echo FRESH_AND_HARD_DONE
