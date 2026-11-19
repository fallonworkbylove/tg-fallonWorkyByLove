#!/usr/bin/env node
/**
 * Для каждого PROXY_LIST: TG DC :443 + generic HTTPS (1.1.1.1:443) + api.openai.com:443
 */
require('dotenv').config();
const { SocksClient } = require('socks');

const raw = process.env.PROXY_LIST || '';
const list = [];
for (const e of raw.split(';')) {
  const p = e.trim().split(':');
  if ((p[0] || '').toLowerCase() !== 'socks5') continue;
  list.push({
    host: p[1],
    port: +p[2],
    userId: p[3],
    password: p[4],
  });
}

const DEST = {
  tg: [
    { host: '149.154.167.51', port: 443 },
    { host: '149.154.175.54', port: 443 },
  ],
  any: [{ host: '1.1.1.1', port: 443 }],
  openai: [{ host: 'api.openai.com', port: 443 }],
};

async function canConnect(px, destinations, timeout = 7000) {
  for (const destination of destinations) {
    try {
      const info = await SocksClient.createConnection({
        proxy: {
          host: px.host,
          port: px.port,
          type: 5,
          userId: px.userId,
          password: px.password,
        },
        command: 'connect',
        destination,
        timeout,
      });
      try {
        info.socket.destroy();
      } catch (_) {}
      return true;
    } catch (_) {}
  }
  return false;
}

(async () => {
  let tgOk = 0;
  let anyOk = 0;
  let openaiOk = 0;
  let dead = 0;
  const rows = [];
  for (const px of list) {
    const tg = await canConnect(px, DEST.tg);
    const any = await canConnect(px, DEST.any);
    const openai = await canConnect(px, DEST.openai);
    if (tg) tgOk += 1;
    if (any) anyOk += 1;
    if (openai) openaiOk += 1;
    if (!tg && !any && !openai) dead += 1;
    let kind = 'DEAD';
    if (tg) kind = 'TG_OK';
    else if (any || openai) kind = 'TG_FAIL_BUT_ALIVE';
    rows.push({ host: `${px.host}:${px.port}`, kind, tg, any, openai });
    console.log(
      kind,
      `${px.host}:${px.port}`,
      `tg=${tg ? 1 : 0}`,
      `https=${any ? 1 : 0}`,
      `openai=${openai ? 1 : 0}`,
    );
  }
  console.log('---');
  console.log('TOTAL', list.length);
  console.log('TG_OK', tgOk);
  console.log('TG_FAIL_BUT_ALIVE', rows.filter((r) => r.kind === 'TG_FAIL_BUT_ALIVE').length);
  console.log('DEAD_EVERYWHERE', dead);
  console.log('ANY_HTTPS_OK', anyOk);
  console.log('OPENAI_OK', openaiOk);
})();
