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
  const [cols] = await db.query('DESCRIBE accounts');
  console.log(
    'cols',
    cols.map((c) => c.Field).join(','),
  );

  const [rows] = await db.query(
    `SELECT id, user_id, phone, LENGTH(session_string) AS sess_len,
            LEFT(COALESCE(prompt,''), 50) AS prompt, created_at, updated_at
     FROM accounts
     WHERE phone LIKE '%9663250798%' OR phone LIKE '%79663250798%'
     ORDER BY id DESC LIMIT 5`,
  );
  console.log('match', JSON.stringify(rows, null, 2));

  if (!rows.length) {
    process.exit(0);
  }

  const [full] = await db.query(
    `SELECT id, phone, session_string FROM accounts WHERE id = ? LIMIT 1`,
    [rows[0].id],
  );
  const acc = full[0];
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const proxy = parseProxyList(process.env.PROXY_LIST)[0];
  console.log('probe session id=', acc.id, 'proxy=', proxy && `${proxy.ip}:${proxy.port}`);

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
        id: String(me.id),
        phone: me.phone,
        username: me.username,
        firstName: me.firstName,
      }),
    );

    // Последние сообщения от Telegram (код входа живёт тут, если ещё не истёк)
    try {
      const entity = await client.getEntity(777000);
      const msgs = await client.getMessages(entity, { limit: 5 });
      for (const m of msgs) {
        const text = String(m.message || '').replace(/\s+/g, ' ').slice(0, 200);
        console.log('TG_MSG', m.date, text);
      }
    } catch (e) {
      console.log('TG_CHAT_FAIL', e.errorMessage || e.message);
    }
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
