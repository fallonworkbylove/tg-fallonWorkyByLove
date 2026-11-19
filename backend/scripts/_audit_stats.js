require('dotenv').config();
const db = require('../db');
const fs = require('fs');
const path = require('path');

(async () => {
  const [[acc]] = await db.query(
    `SELECT COUNT(*) AS total,
            SUM(is_autoreply_enabled=1) AS ai_on,
            SUM(LENGTH(COALESCE(prompt,''))=0) AS empty_prompt,
            SUM(LENGTH(COALESCE(session_string,''))<50) AS short_session
     FROM accounts`,
  );
  const [[users]] = await db.query(`SELECT COUNT(*) AS total FROM users`);
  const [emptyRows] = await db.query(
    `SELECT id, phone, status, LENGTH(COALESCE(prompt,'')) AS plen,
            LENGTH(COALESCE(session_string,'')) AS sess
     FROM accounts
     WHERE LENGTH(COALESCE(prompt,''))=0 OR LENGTH(COALESCE(session_string,''))<50
     ORDER BY id`,
  );
  const [phones] = await db.query(
    `SELECT id, phone, status, is_autoreply_enabled AS ai,
            LENGTH(COALESCE(prompt,'')) AS plen
     FROM accounts ORDER BY id`,
  );

  let tables = [];
  try {
    const [t] = await db.query(`SHOW TABLES`);
    tables = t.map((r) => Object.values(r)[0]);
  } catch (_) {}

  const loginProxies = fs.existsSync(path.join(__dirname, '../config/proxies-login.txt'))
    ? fs.readFileSync(path.join(__dirname, '../config/proxies-login.txt'), 'utf8').split(/\n/).filter((l) => l.trim() && !l.startsWith('#')).length
    : 0;

  console.log(
    JSON.stringify(
      {
        apiId: process.env.TELEGRAM_API_ID,
        authBypass: process.env.TELEGRAM_AUTH_BYPASS,
        accounts: acc,
        users,
        emptyOrBroken: emptyRows,
        phones,
        tables,
        loginProxiesFile: loginProxies,
        workProxiesEnv: String(process.env.PROXY_LIST || '')
          .split(/;/)
          .filter(Boolean).length,
      },
      null,
      2,
    ),
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
