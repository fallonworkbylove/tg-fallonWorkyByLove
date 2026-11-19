/* Probe ExportLoginToken via WORK (PROXY_LIST) DC proxies + 443. */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { TelegramClient, Api } = require('telegram');
const { ConnectionTCPFull } = require('telegram/network');
const { StringSession } = require('telegram/sessions');

class ConnectionTCPFull443 extends ConnectionTCPFull {
  constructor(params) {
    super({ ...params, port: 443 });
  }
}

function race(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`TIMEOUT ${label} ${ms}ms`)), ms);
    }),
  ]);
}

function parseProxyList(raw) {
  return String(raw || '')
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      let s = line.replace(/^socks5:\/\//i, '').replace(/^socks5:/i, '');
      // host:port:user:pass
      const parts = s.split(':');
      if (parts.length < 2) return null;
      const proxy = {
        ip: parts[0],
        port: Number(parts[1]),
        socksType: 5,
      };
      if (parts.length >= 4) {
        proxy.username = parts[2];
        proxy.password = parts.slice(3).join(':');
      }
      return proxy;
    })
    .filter(Boolean);
}

async function tryOne(label, apiId, apiHash, opts) {
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 1,
    timeout: 10,
    deviceModel: 'Desktop',
    systemVersion: 'Windows 10',
    appVersion: '5.14.3 x64',
    langCode: 'ru',
    systemLangCode: 'ru-RU',
    ...opts,
  });
  const t0 = Date.now();
  try {
    await race(client.connect(), 15000, 'connect');
    console.log(`  connected ${Date.now() - t0}ms connected=${client.connected}`);
    // sanity: getConfig
    try {
      const cfg = await race(client.invoke(new Api.help.GetConfig()), 12000, 'getConfig');
      console.log(`  getConfig ok dc=${cfg?.thisDc} ${Date.now() - t0}ms`);
    } catch (e) {
      console.log(`  getConfig FAIL ${e.errorMessage || e.message} ${Date.now() - t0}ms`);
    }
    const result = await race(
      client.invoke(
        new Api.auth.ExportLoginToken({
          apiId: Number(apiId),
          apiHash,
          exceptIds: [],
        }),
      ),
      15000,
      'export',
    );
    const tokenLen = result?.token ? Buffer.from(result.token).length : 0;
    console.log(`  export OK ${result.className} tokenLen=${tokenLen} ${Date.now() - t0}ms`);
    try {
      await client.disconnect();
    } catch (_) {}
    return true;
  } catch (err) {
    console.log(`  FAIL ${err.errorMessage || err.message} ${Date.now() - t0}ms`);
    try {
      await client.disconnect();
    } catch (_) {}
    return false;
  }
}

(async () => {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const work = parseProxyList(process.env.PROXY_LIST);
  console.log(`api=${apiId} workProxies=${work.length}`);

  // try first 5 work proxies
  for (const p of work.slice(0, 5)) {
    const label = `work443 ${p.ip}:${p.port}`;
    console.log('try', label);
    const ok = await tryOne(label, apiId, apiHash, {
      proxy: p,
      connection: ConnectionTCPFull443,
    });
    if (ok) {
      console.log('SUCCESS', label);
      process.exit(0);
    }
  }

  console.log('try direct443');
  const ok = await tryOne('direct443', apiId, apiHash, {
    connection: ConnectionTCPFull443,
  });
  process.exit(ok ? 0 : 1);
})();
