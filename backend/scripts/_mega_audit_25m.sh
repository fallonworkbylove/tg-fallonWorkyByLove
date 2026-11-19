#!/bin/bash
set -euo pipefail
LOG=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log
SLICE=$(tail -c 500000 "$LOG" 2>/dev/null || true)
ESLICE=$(tail -c 150000 "$ERR" 2>/dev/null || true)
count() { printf '%s' "$1" | grep -acE "$2" || true; }

OTVET=$(count "$SLICE" 'Ответ для')
SLEEP_MSG=$(count "$SLICE" 'получено во сне')
CATCH_SKIP=$(count "$SLICE" 'Catch-up skip')
CATCH_OK=$(count "$SLICE" 'Скан завершён')
HOWLONG=$(count "$SLICE" 'ответил, сколько на дв')
FILTER=$(count "$SLICE" 'отсев')
OPENAI_ERR=$(count "$ESLICE$SLICE" 'OpenAI|billing|429|AI не дал')
PEER_INV=$(count "$ESLICE$SLICE" 'PEER_ID_INVALID')
FROZEN=$(count "$ESLICE$SLICE" 'FROZEN_METHOD')
ECONN=$(count "$ESLICE$SLICE" 'ECONNRESET|SocksClientError')
BOT_FETCH=$(count "$ESLICE" 'fetch failed')
BUSY=$(count "$SLICE" 'Занята')

pm2 jlist > /tmp/pm2j.json
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("/tmp/pm2j.json","utf8")).find(x=>x.name==="tgbot");const pl=(p.pm2_env.PROXY_LIST||"").split(";").filter(Boolean);fs.writeFileSync("/tmp/pm2_meta.json",JSON.stringify({status:p.pm2_env.status,up_min:+((Date.now()-p.pm2_env.pm_uptime)/60000).toFixed(1),restarts:p.pm2_env.restart_time,proxy:pl.length,pid:p.pid}));'

cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node <<'NODE'
require('dotenv').config();
const db=require('./db');
const fs=require('fs');
(async()=>{
  const [[c]]=await db.execute(`SELECT
    SUM(role='assistant' AND created_at>NOW()-INTERVAL 25 MINUTE) bot25,
    SUM(role='user' AND created_at>NOW()-INTERVAL 25 MINUTE) user25,
    SUM(role='assistant' AND content LIKE '%nft.ogg%' AND created_at>NOW()-INTERVAL 24 HOUR) nft_voice_24h,
    SUM(role='assistant' AND (content LIKE '%[медиа:%' OR content LIKE '%фото%') AND created_at>NOW()-INTERVAL 25 MINUTE) media25,
    SUM(role='assistant' AND content LIKE '%на дв?%' AND created_at>NOW()-INTERVAL 24 HOUR) howlong_ask_24h
  FROM conversation_messages`);
  const [accRows]=await db.execute(`SELECT id, phone FROM accounts ORDER BY id`);
  const [[filt]]=await db.execute(`SELECT COUNT(*) n FROM operator_lead_flags WHERE funnel_stage='filtered' AND updated_at>NOW()-INTERVAL 24 HOUR`);
  let arch24=null;
  try{const [[a]]=await db.execute(`SELECT COUNT(*) n FROM archived_peers WHERE archived_at>NOW()-INTERVAL 24 HOUR`);arch24=a.n;}catch(_){}
  const [perAcc]=await db.execute(`SELECT account_id, SUM(role='assistant') bot, SUM(role='user') usr
    FROM conversation_messages WHERE created_at>NOW()-INTERVAL 25 MINUTE GROUP BY account_id ORDER BY bot DESC`);
  fs.writeFileSync('/tmp/mega_db.json', JSON.stringify({c, filt24:filt.n, arch24, accounts:accRows.length, perAcc}));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
NODE

python3 - <<PY
import json
meta=json.load(open('/tmp/pm2_meta.json'))
db=json.load(open('/tmp/mega_db.json'))
rep={
  "pm2": meta,
  "logs": {
    "otvet_slice": int("$OTVET"),
    "sleep_defer": int("$SLEEP_MSG"),
    "catch_skip": int("$CATCH_SKIP"),
    "catch_ok": int("$CATCH_OK"),
    "howlong": int("$HOWLONG"),
    "otsev_word": int("$FILTER"),
    "openai_err": int("$OPENAI_ERR"),
    "peer_invalid": int("$PEER_INV"),
    "frozen": int("$FROZEN"),
    "econn": int("$ECONN"),
    "bot_fetch_fail": int("$BOT_FETCH"),
    "busy": int("$BUSY"),
  },
  "db": db,
}
json.dump(rep, open('/tmp/mega_audit_25m.json','w'), ensure_ascii=False, indent=2)
print(json.dumps(rep, ensure_ascii=False, indent=2))
print('MEGA_LIVE_OK')
PY
