#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
bash scripts/_force_alive_proxy_pm2.sh
sleep 12
echo "=== after force: PROXY ==="
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print(e["status"], len([x for x in (e.get("PROXY_LIST")or"").split(";") if x.strip()]))'
echo "=== activate 29+34 ==="
node - <<'NODE'
require('dotenv').config({ path: '.env' });
const mysql = require('mysql2/promise');
const { activateAccount, deactivateAccount, getActiveClient } = require('./services/telegramClient');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });
  for (const id of [29, 34]) {
    const [rows] = await c.query('SELECT id, phone, session_string, status, is_autoreply_enabled FROM accounts WHERE id=?', [id]);
    const acc = rows[0];
    if (!acc) { console.log('missing', id); continue; }
    console.log('before', id, acc.phone, 'activeClient=', !!getActiveClient(id));
    await deactivateAccount(id).catch(() => {});
    const ok = await activateAccount(id, acc.session_string);
    console.log('activate', id, acc.phone, '=>', ok, 'activeClient=', !!getActiveClient(id));
  }
  await c.end();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE
echo "=== recent connect ==="
sleep 3
grep -aE 'аккаунт 29|аккаунт 34|Машенька|Анастасия Суворова|активирован' /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -25
echo RECONNECT_DONE