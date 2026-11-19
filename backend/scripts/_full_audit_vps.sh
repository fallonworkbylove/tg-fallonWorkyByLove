#!/bin/bash
# Короткий полный срез логов + БД. Без зависаний.
set -euo pipefail
ERR=/root/.pm2/logs/tgbot-error.log
OUT=/root/.pm2/logs/tgbot-out.log
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

echo "===== PM2 ====="
pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const a=JSON.parse(d);for(const p of a){if(p.name==="tgbot")console.log({name:p.name,status:p.pm2_env.status,restarts:p.pm2_env.restart_time,uptime_ms:Date.now()-p.pm2_env.pm_uptime,mem:p.monit&&p.monit.memory});}})'

echo
echo "===== ERR patterns (8k) ====="
tail -n 8000 "$ERR" | grep -oE 'INVITE_HASH_EXPIRED|Invalid body|PHONE_CODE_INVALID|fetch failed|FLOOD_WAIT|AUTH_KEY|SESSION|USER_DEACTIVATED|PEER_FLOOD|TIMEOUT|ECONNRESET|OpenAI|403|429' | sort | uniq -c | sort -rn || true

echo
echo "===== INVITE accounts ====="
tail -n 8000 "$ERR" | grep 'INVITE_HASH_EXPIRED' | sed -E 's/\].*$/]/' | sort | uniq -c | sort -rn | head -10 || true

echo
echo "===== Invalid body accounts ====="
tail -n 8000 "$ERR" | grep 'Invalid body' | grep -oE 'аккаунт [0-9]+|\[[^]]+\]' | sort | uniq -c | sort -rn | head -15 || true

echo
echo "===== AUTH/SESSION samples ====="
tail -n 8000 "$ERR" | grep -E 'AUTH_KEY|SESSION|USER_DEACTIVATED|PEER_FLOOD' | tail -20 || true

echo
echo "===== OUT last hour-ish keywords ====="
tail -n 6000 "$OUT" | grep -cE 'Ошибка отправки медиа' || true
tail -n 6000 "$OUT" | grep -cE 'Автоответ отключ' || true
tail -n 6000 "$OUT" | grep -cE 'занята' || true
tail -n 6000 "$OUT" | grep -cE 'Flood|flood wait' || true
tail -n 6000 "$OUT" | grep -cE 'Спит по режиму' || true

echo
echo "===== Recent bad media / replies ====="
tail -n 3000 "$OUT" | grep -E 'Ошибка отправки медиа|mediaMiss|Не удалось отправить|Invalid body' | tail -25 || true

echo
echo "===== DB snapshot ====="
node scripts/_audit_db_media.js || true
node -e '
require("dotenv").config();
const db=require("./db");
(async()=>{
  const [[acc]]=await db.execute("SELECT COUNT(*) c, SUM(is_autoreply_enabled=1) onn FROM accounts");
  console.log("accounts:", acc);
  const [[m]]=await db.execute("SELECT COUNT(*) c FROM conversation_messages WHERE created_at > NOW() - INTERVAL 1 DAY");
  console.log("msgs_24h:", m.c);
  const [[a]]=await db.execute("SELECT COUNT(*) c FROM conversation_messages WHERE role=\"assistant\" AND created_at > NOW() - INTERVAL 6 HOUR");
  const [[u]]=await db.execute("SELECT COUNT(*) c FROM conversation_messages WHERE role=\"user\" AND created_at > NOW() - INTERVAL 6 HOUR");
  console.log("last6h user/asst:", u.c, a.c);
  const [bad]=await db.execute(`SELECT account_id, peer_id, LEFT(content,120) c, created_at
    FROM conversation_messages
    WHERE role=\"assistant\" AND created_at > NOW() - INTERVAL 12 HOUR
      AND (content REGEXP \"распаков|я в .* уже живу|спокойной ночи|какая весна\"
           OR content LIKE \"%а ты давно там%\"
           OR content LIKE \"%а ты там жив%\")
    ORDER BY id DESC LIMIT 25`);
  console.log("--- suspicious assistant (12h) ---");
  for (const r of bad) console.log(String(r.created_at), "acc"+r.account_id, r.peer_id, r.c);
  const [links]=await db.execute(`SELECT id, phone, LEFT(IFNULL(media_chat_link,\"\"),80) link
    FROM accounts WHERE IFNULL(media_chat_link,\"\")!=\"\"`);
  console.log("--- media links ---");
  for (const r of links) console.log(r.id, r.phone, r.link);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
'
