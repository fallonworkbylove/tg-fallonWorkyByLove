#!/bin/bash
set -u
OUT=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log
B=/root/opt/tgbot/tg-miniapp-loverussian/backend

echo "=== TIME MSK ==="
TZ=Europe/Moscow date

echo "=== PM2 / PROXY ==="
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print(e["status"],"PROXY",len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]))'

echo "=== ACCOUNT LINES (Маш|Наст|Анастасия|796018|793220) last ==="
grep -aE 'Машенька|Анастасия|79601878688|79322088586' "$OUT" | tail -60

echo "=== SKIP / QUIET / BUSY / SLEEP for them ==="
grep -aE 'Машенька|Анастасия|79601878688|79322088586' "$OUT" "$ERR" 2>/dev/null | grep -aEi 'Занята|quiet|тихие|sleep|молчу|skip|отсев|filtered|AI замолчал|не отвеч|offline|DISCONNECT|Flood|AUTH|proxy|DEAD|timeout|catch-up|silence' | tail -40

echo "=== LAST REPLIES FROM MASHA/NASTA ==="
grep -aE '\[79601878688 — Машенька\]|\[79322088586 —' "$OUT" | grep -a 'Ответ для' | tail -20

echo "=== LAST INBOUND mentioning them ==="
grep -aE 'Машенька|Анастасия Суворова|79601878688|79322088586' "$OUT" | grep -aEi 'входящ|Inbound|сообщение|New message|peer=' | tail -20

echo "=== CLIENT ONLINE? ==="
grep -aE 'Машенька|Анастасия|79601878688|79322088586' "$OUT" "$ERR" 2>/dev/null | grep -aEi 'подключ|connect|online|offline|startClient|GramJS|session|не удалось' | tail -25

echo "=== DB peek if node can ==="
cd "$B" && node - <<'NODE' 2>/dev/null || echo 'db_skip'
require('dotenv').config({path:'.env'});
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT||3306),
  });
  const [rows] = await c.query(`
    SELECT id, phone, first_name, username, status, is_active, sleep_until, last_online, updated_at
    FROM accounts
    WHERE phone LIKE '%601878688%' OR phone LIKE '%322088586%'
       OR first_name LIKE '%Маш%' OR first_name LIKE '%Анастас%' OR first_name LIKE '%Наст%'
    LIMIT 20`);
  console.log(JSON.stringify(rows, null, 2));
  await c.end();
})().catch(e => console.log('db_err', e.message));
NODE

echo DIAG_DONE
