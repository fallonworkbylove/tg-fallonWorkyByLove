#!/bin/bash
set -euo pipefail
ERR=/root/.pm2/logs/tgbot-error.log
OUT=/root/.pm2/logs/tgbot-out.log
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

echo "===== PM2 ====="
pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const a=JSON.parse(d);for(const p of a){if(p.name==="tgbot")console.log({status:p.pm2_env.status,restarts:p.pm2_env.restart_time,uptime_min:Math.round((Date.now()-p.pm2_env.pm_uptime)/60000),mem_mb:Math.round((p.monit&&p.monit.memory||0)/1e6)});}})'

echo
echo "===== ERR patterns (last 6k, since recent deploys) ====="
tail -n 6000 "$ERR" | grep -oE 'INVITE_HASH_EXPIRED|Invalid body|prompt is not defined|PHONE_CODE_INVALID|fetch failed|FLOOD_WAIT|AUTH_KEY|SESSION|USER_DEACTIVATED|PEER_FLOOD|TIMEOUT|ECONNRESET|ReferenceError|TypeError|is not defined' | sort | uniq -c | sort -rn || true

echo
echo "===== ERR last 40 unique-ish ====="
tail -n 200 "$ERR" | grep -vE 'gramJS|Disconnecting|Connecting|Sleeping for|injected env' | tail -40 || true

echo
echo "===== OUT keywords (4k) ====="
echo -n "media_err: "; tail -n 4000 "$OUT" | grep -c 'Ошибка отправки медиа' || true
echo -n "invite_dead_msg: "; tail -n 4000 "$OUT" | grep -c 'Медиа-ссылка протухла' || true
echo -n "autoreply_off: "; tail -n 4000 "$OUT" | grep -c 'Автоответ отключ' || true
echo -n "lead_retry: "; tail -n 4000 "$OUT" | grep -c 'digest_sent_at не ставлю' || true
echo -n "prompt_bug: "; tail -n 4000 "$ERR" | grep -c 'prompt is not defined' || true
echo -n "busy: "; tail -n 4000 "$OUT" | grep -c 'занята' || true

echo
echo "===== DB ====="
node -e '
require("dotenv").config();
const db=require("./db");
(async()=>{
  const [[acc]]=await db.execute("SELECT COUNT(*) c, SUM(is_autoreply_enabled=1) onn FROM accounts");
  console.log("accounts", acc);
  const [[m24]]=await db.execute("SELECT COUNT(*) c FROM conversation_messages WHERE created_at > NOW() - INTERVAL 1 DAY");
  const [[u6]]=await db.execute("SELECT COUNT(*) c FROM conversation_messages WHERE role=\"user\" AND created_at > NOW() - INTERVAL 6 HOUR");
  const [[a6]]=await db.execute("SELECT COUNT(*) c FROM conversation_messages WHERE role=\"assistant\" AND created_at > NOW() - INTERVAL 6 HOUR");
  console.log("msgs_24h", m24.c, "last6h user/asst", u6.c, a6.c);

  const [links]=await db.execute(`SELECT id, phone, is_autoreply_enabled,
    LEFT(IFNULL(media_chat_link,\"\"),85) link FROM accounts WHERE IFNULL(media_chat_link,\"\")!=\"\"`);
  console.log("--- media links ---");
  for (const r of links) console.log(r.id, r.phone, "on="+r.is_autoreply_enabled, r.link);

  const [bad]=await db.execute(`SELECT account_id, peer_id, LEFT(content,110) c, created_at
    FROM conversation_messages
    WHERE role=\"assistant\" AND created_at > NOW() - INTERVAL 3 HOUR
      AND (
        content REGEXP \"распаков|разлажив|заранее.*распаков\"
        OR content LIKE \"%какая весна%\"
        OR content LIKE \"%чем могу помочь%\"
        OR content LIKE \"%а ты давно там%\"
        OR content LIKE \"%[медиа:#%\"
        OR content LIKE \"%{кружок:%\"
        OR content LIKE \"%{фото:%\"
        OR (content LIKE \"%спокойной%\" AND HOUR(CONVERT_TZ(created_at,\"+00:00\",\"+03:00\")) BETWEEN 8 AND 20)
      )
    ORDER BY id DESC LIMIT 30`);
  console.log("--- suspicious asst last 3h (MSK day goodnight / unpack / leak / robotic) ---");
  if (!bad.length) console.log("(none)");
  for (const r of bad) console.log(String(r.created_at), "acc"+r.account_id, r.peer_id, r.c);

  const [pairs]=await db.execute(`
    SELECT a.account_id, a.peer_id,
      LEFT(MAX(CASE WHEN a.rn=1 THEN a.content END),80) last_asst,
      LEFT(MAX(CASE WHEN u.rn=1 THEN u.content END),80) last_user
    FROM (
      SELECT account_id, peer_id, content,
        ROW_NUMBER() OVER (PARTITION BY account_id, peer_id ORDER BY id DESC) rn
      FROM conversation_messages WHERE role=\"assistant\" AND created_at > NOW() - INTERVAL 2 HOUR
    ) a
    LEFT JOIN (
      SELECT account_id, peer_id, content,
        ROW_NUMBER() OVER (PARTITION BY account_id, peer_id ORDER BY id DESC) rn
      FROM conversation_messages WHERE role=\"user\" AND created_at > NOW() - INTERVAL 2 HOUR
    ) u ON u.account_id=a.account_id AND u.peer_id=a.peer_id AND u.rn=1
    WHERE a.rn=1
    GROUP BY a.account_id, a.peer_id
    ORDER BY a.account_id
    LIMIT 15
  `).catch(()=>[[]]);
  console.log("--- sample recent pairs (2h) ---");
  for (const r of pairs||[]) console.log("acc"+r.account_id, r.peer_id, "|U:", r.last_user, "|A:", r.last_asst);

  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
'
