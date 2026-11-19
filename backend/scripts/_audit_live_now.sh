#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

echo "==== PM2 ===="
pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const a=JSON.parse(d);const p=a.find(x=>x.name==="tgbot");if(!p){console.log("no tgbot");return;}console.log({status:p.pm2_env.status,uptime:p.pm2_env.pm_uptime,restarts:p.pm2_env.restart_time,unstable:p.pm2_env.unstable_restarts});});'

echo "==== ERR TOP ===="
grep -E 'Error|TypeError|ReferenceError|Ошибка|FAIL|Not connected|fetch failed|unsupported image|OpenAI|429|ECONN' /root/.pm2/logs/tgbot-error.log 2>/dev/null \
  | sed -E 's/[0-9]{2,}//g; s/x[0-9]+/xN/g; s/\([^)]*\)//g' \
  | sort | uniq -c | sort -rn | head -30

echo "==== ERR LAST 40 ===="
tail -n 40 /root/.pm2/logs/tgbot-error.log

echo "==== OUT LAST HINTS ===="
tail -n 200 /root/.pm2/logs/tgbot-out.log | grep -iE 'reply|openai|skip|mute|archive|warn|generate|hint|nft|error|empty|stub' | tail -50

echo "==== REQUIRE ===="
node - <<'NODE'
require('dotenv').config();
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-x';
const mods = [
  'aiResponder','telegramClient','objectionHandler','softHumanLite',
  'humanThinLayer','humanExtra','moodEngine','humanizeSpeech','learningDb',
  'ragExamples','mediaReplies','voiceReplies','helpRequestNotifier'
];
for (const m of mods) {
  try { require('./services/' + m); console.log('ok', m); }
  catch (e) { console.log('FAIL', m, e.message.split('\n')[0]); }
}
NODE

echo "==== RECENT PAIRS SQL ===="
node - <<'NODE'
require('dotenv').config();
const db = require('./db');
(async () => {
  try {
    const [rows] = await db.execute(`
      SELECT account_id, peer_id, role, LEFT(content, 160) AS content, created_at
      FROM messages
      WHERE created_at >= NOW() - INTERVAL 6 HOUR
        AND content NOT LIKE '[реакция:%'
        AND content NOT LIKE '[медиа:%'
      ORDER BY id DESC
      LIMIT 40
    `);
    for (const r of rows) {
      console.log(
        String(r.created_at).slice(0, 19),
        'a' + r.account_id,
        'p' + String(r.peer_id).slice(0, 10),
        r.role === 'assistant' ? 'BOT' : 'USR',
        JSON.stringify(String(r.content || '').replace(/\s+/g, ' ')),
      );
    }
    console.log('pairs', rows.length);
  } catch (e) {
    console.log('SQL_FAIL', e.message);
  }
  process.exit(0);
})();
NODE
