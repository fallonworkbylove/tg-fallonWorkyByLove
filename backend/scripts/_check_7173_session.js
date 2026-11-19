require('dotenv').config();
if (process.env.ALLOW_DUAL_GRAMJS !== '1') {
  console.error(
    '[guard] Dual GramJS запрещён при живом tgbot. Задай ALLOW_DUAL_GRAMJS=1 только если процесс остановлен.',
  );
  process.exit(2);
}
const db = require('../db');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { ConnectionTCPFull } = require('telegram/network');

class C443 extends ConnectionTCPFull {
  constructor(p) {
    super({ ...p, port: 443 });
  }
}

function parseProxyList(raw) {
  return String(raw || '')
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const s = line.replace(/^socks5:\/\//i, '').replace(/^socks5:/i, '');
      const parts = s.split(':');
      if (parts.length < 2) return null;
      const proxy = { ip: parts[0], port: Number(parts[1]), socksType: 5 };
      if (parts.length >= 4) {
        proxy.username = parts[2];
        proxy.password = parts.slice(3).join(':');
      }
      return proxy;
    })
    .filter(Boolean);
}

(async () => {
  const [rows] = await db.query(
    `SELECT id, user_id, phone, LENGTH(session_string) AS sess_len, status,
            is_autoreply_enabled, LEFT(COALESCE(prompt,''), 50) AS prompt
     FROM accounts WHERE id = 2 OR phone LIKE '%9959307173%' OR phone LIKE '%995%930%71%73%'
     ORDER BY id LIMIT 3`,
  );
  console.log('db', JSON.stringify(rows, null, 2));
  if (!rows.length) {
    process.exit(1);
  }

  const [full] = await db.query(
    `SELECT id, phone, session_string FROM accounts WHERE id = ? LIMIT 1`,
    [rows[0].id],
  );
  const acc = full[0];
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const proxy = parseProxyList(process.env.PROXY_LIST)[0];

  const client = new TelegramClient(new StringSession(acc.session_string || ''), apiId, apiHash, {
    connectionRetries: 1,
    timeout: 12,
    proxy,
    connection: C443,
    deviceModel: 'Desktop',
    systemVersion: 'Windows 10',
    appVersion: '5.14.3 x64',
    langCode: 'ru',
    systemLangCode: 'ru-RU',
  });

  try {
    await client.connect();
    const me = await client.getMe();
    console.log(
      'SESSION_OK',
      JSON.stringify({
        phone: me.phone,
        username: me.username || null,
        firstName: me.firstName || null,
        id: String(me.id),
      }),
    );
  } catch (e) {
    console.log('SESSION_DEAD', e.errorMessage || e.message);
  } finally {
    try {
      await client.disconnect();
    } catch (_) {}
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
