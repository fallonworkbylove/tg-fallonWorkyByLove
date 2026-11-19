require('dotenv').config();
const fs = require('fs');
const { TelegramClient, Api } = require('telegram');
const { ConnectionTCPFull } = require('telegram/network');
const { StringSession } = require('telegram/sessions');

class C443 extends ConnectionTCPFull {
  constructor(p) {
    super({ ...p, port: 443 });
  }
}

function parse(line) {
  const s = line.replace(/^socks5:\/\//i, '');
  const parts = s.split(':');
  return {
    ip: parts[0],
    port: Number(parts[1]),
    socksType: 5,
    username: parts[2],
    password: parts.slice(3).join(':'),
  };
}

(async () => {
  const lines = fs
    .readFileSync('config/proxies-login.txt', 'utf8')
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  for (const line of lines) {
    const proxy = parse(line);
    console.log('try', proxy.ip + ':' + proxy.port);
    const c = new TelegramClient(new StringSession(''), apiId, apiHash, {
      connectionRetries: 1,
      timeout: 10,
      proxy,
      connection: C443,
      deviceModel: 'Desktop',
      systemVersion: 'Windows 10',
      appVersion: '5.14.3 x64',
      langCode: 'ru',
      systemLangCode: 'ru-RU',
    });
    const t = Date.now();
    try {
      const ok = await c.connect();
      console.log('  connect', ok, c.connected, Date.now() - t);
      const r = await c.invoke(
        new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] }),
      );
      console.log('  export', r.className, r.token && r.token.length, Date.now() - t);
      await c.disconnect();
      process.exit(0);
    } catch (e) {
      console.log('  FAIL', e.errorMessage || e.message, Date.now() - t);
      try {
        await c.disconnect();
      } catch (_) {}
    }
  }
  process.exit(1);
})();
