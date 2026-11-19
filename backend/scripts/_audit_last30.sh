#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

echo "=== ULTRA AUDIT (last ~30m window) ==="
SINCE=$(date -u +'%Y-%m-%d %H:%M:%S' -d '30 minutes ago')
echo "FIX_SINCE=$SINCE"
AUDIT_FIX_SINCE="$SINCE" node scripts/_ultra_hard_audit.js | tee /tmp/aud30.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|"findings"|assistant_since|short_1|mid_9|long_40|ai_on|stale'

python3 - <<'PY'
import json
t=open('/tmp/aud30.txt',encoding='utf-8').read()
o=json.loads(t[t.find('{'):t.rfind('}')+1])
print('---SUMMARY---')
print(json.dumps({
  'overall': o['overall'],
  'score': o['score'],
  'checks': o['checks'],
  'findings': o['findings'],
  'volume': o['volume'],
  'reply_length': o['reply_length_since_fix'],
  'accounts': o['accounts'],
  'stale_gaps': o.get('stale_gaps',[])[:8],
  'stubs': o.get('stub_samples',[])[:5],
  'leaks': o.get('leak_samples',[])[:5],
}, ensure_ascii=False, indent=2))
fails=[]
for k,arr in o.get('checks_detail',{}).items():
  for c in arr:
    if not c['pass']:
      fails.append(f"{k}:{c['name']} {c.get('detail','')}")
print('FAILS', fails or 'none')
PY

echo
echo "=== DB REPLIES last 30m (sample) ==="
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [asst] = await db.execute(`
    SELECT account_id, LEFT(content, 100) c, created_at
    FROM conversation_messages
    WHERE role='assistant' AND created_at >= NOW() - INTERVAL 30 MINUTE
      AND content NOT LIKE '[медиа:%'
    ORDER BY id DESC LIMIT 25`);
  const [user] = await db.execute(`
    SELECT COUNT(*) c FROM conversation_messages
    WHERE role='user' AND created_at >= NOW() - INTERVAL 30 MINUTE`);
  const [ac] = await db.execute(`
    SELECT COUNT(*) c FROM conversation_messages
    WHERE role='assistant' AND created_at >= NOW() - INTERVAL 30 MINUTE`);
  const [bad] = await db.execute(`
    SELECT account_id, content, created_at FROM conversation_messages
    WHERE role='assistant' AND created_at >= NOW() - INTERVAL 30 MINUTE
      AND (
        TRIM(content) IN ('а ещё)','а ещё','ага','ага)','круто)','ну да)','хм ок')
        OR content LIKE '%[отправила %'
        OR content LIKE '%чем могу помочь%'
      )
    ORDER BY id DESC LIMIT 15`);
  const [gaps] = await db.execute(`
    SELECT cm.account_id, cm.peer_id, LEFT(cm.content,70) c,
      TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
    FROM conversation_messages cm
    JOIN accounts a ON a.id=cm.account_id
    WHERE cm.role='user' AND cm.created_at >= NOW() - INTERVAL 30 MINUTE
      AND a.is_autoreply_enabled=1 AND IFNULL(a.prompt,'')!=''
      AND NOT EXISTS (
        SELECT 1 FROM conversation_messages x
        WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id
          AND x.role='assistant' AND x.id>cm.id)
      AND NOT EXISTS (
        SELECT 1 FROM autoreply_disabled_peers ad
        WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
      AND NOT EXISTS (
        SELECT 1 FROM archived_peers ap
        WHERE ap.account_id=cm.account_id AND ap.peer_id=cm.peer_id)
    ORDER BY cm.id DESC LIMIT 20`);
  console.log(JSON.stringify({ user_30m: user[0].c, asst_30m: ac[0].c, bad_n: bad.length, gaps_n: gaps.length }, null, 2));
  console.log('---bad---');
  for (const r of bad) console.log(String(r.created_at), 'acc'+r.account_id, JSON.stringify(r.content));
  console.log('---gaps---');
  for (const r of gaps) console.log(r.age_m+'m', 'acc'+r.account_id, r.peer_id, r.c);
  console.log('---asst_sample---');
  for (const r of asst) console.log(String(r.created_at), 'acc'+r.account_id, JSON.stringify(r.c));
  process.exit(0);
})().catch((e)=>{console.error(e);process.exit(1);});
NODE

echo
echo "=== PM2 ERR last lines (filter) ==="
pm2 logs tgbot --err --lines 80 --nostream 2>/dev/null | grep -v telegramAuth | grep -iE 'Ошибка обработки|is not defined|TypeError|ReferenceError|ECONNREFUSED|Invalid body' | tail -20 || echo clean_err

echo
echo "=== PM2 OUT last 30-ish (replies/catchup) ==="
pm2 logs tgbot --out --lines 120 --nostream 2>/dev/null | grep -iE 'Catch-up|Скан:|Убрал отказ|openai|human|Ошибка' | tail -25 || true

echo
echo "=== POOL ==="
KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)
curl -sS --max-time 40 -H "X-Auth-Bypass-Key: $KEY" http://127.0.0.1:3000/api/accounts/pool-status \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);const ai=(j.accounts||[]).filter(a=>a.ai&&a.has_session);console.log(JSON.stringify({online:j.online,pingOk:j.pingOk,ai_sess:ai.length,ai_online:ai.filter(a=>a.is_online).length,offline_ai:ai.filter(a=>!a.is_online).map(a=>a.id)}))})'

echo AUDIT30_DONE
