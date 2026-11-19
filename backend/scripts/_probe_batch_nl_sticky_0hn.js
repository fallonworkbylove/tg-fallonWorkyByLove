#!/usr/bin/env node
/**
 * Probe raw host:port:user:pass list → SOCKS / api.telegram.org / MTProto DC + egress.
 */
const fs = require('fs');
const tls = require('tls');
const https = require('https');
const { SocksClient } = require('socks');

const FILE = process.argv[2] || '/tmp/nl_sticky_batch.txt';

const DC = [
  { host: '149.154.167.50', port: 443 },
  { host: '149.154.167.51', port: 443 },
  { host: '149.154.175.54', port: 443 },
  { host: '91.108.56.165', port: 443 },
];
const API = [{ host: 'api.telegram.org', port: 443 }];

function parse(line) {
  const s = String(line || '').trim();
  if (!s || s.startsWith('#')) return null;
  const p = s.split(':');
  if (p.length < 4) return null;
  return {
    host: p[0],
    port: Number(p[1]),
    userId: p[2],
    password: p.slice(3).join(':'),
    label: `${p[0]}:${p[1]}:${String(p[2]).slice(-20)}`,
  };
}

async function via(px, destination, timeout = 10000) {
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
}

async function anyOk(px, dests) {
  for (const d of dests) {
    try {
      await via(px, d);
      return { ok: true, dest: `${d.host}:${d.port}` };
    } catch (_) {}
  }
  return { ok: false };
}

async function egress(px) {
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
      destination: { host: 'api.ipify.org', port: 443 },
      timeout: 10000,
    });
    const ip = await new Promise((resolve) => {
      const sock = tls.connect(
        { socket: info.socket, servername: 'api.ipify.org', timeout: 8000 },
        () => {
          sock.write(
            'GET /?format=json HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n',
          );
        },
      );
      let b = '';
      sock.on('data', (c) => (b += c));
      sock.on('end', () => {
        const m = b.match(/"ip"\s*:\s*"([^"]+)/);
        resolve(m ? m[1] : null);
      });
      sock.on('error', () => resolve(null));
    });
    if (!ip) return { ip: null, country: null };
    const geo = await new Promise((resolve) => {
      https
        .get(`https://ipapi.co/${ip}/json/`, { timeout: 6000 }, (res) => {
          let x = '';
          res.on('data', (d) => (x += d));
          res.on('end', () => {
            try {
              resolve(JSON.parse(x));
            } catch (_) {
              resolve(null);
            }
          });
        })
        .on('error', () => resolve(null));
    });
    return {
      ip,
      country: geo && geo.country_code,
      city: geo && geo.city,
      org: geo && geo.org,
    };
  } catch (_) {
    return { ip: null, country: null };
  }
}

(async () => {
  const lines = fs.readFileSync(FILE, 'utf8').split(/\n/);
  const list = lines.map(parse).filter(Boolean);
  console.log(JSON.stringify({ file: FILE, n: list.length }));

  let socksOk = 0;
  let apiOk = 0;
  let dcOk = 0;
  const dcLines = [];

  // egress only for first 3 survivors to save time
  let egressSamples = 0;

  for (const px of list) {
    let socks = false;
    try {
      await via(px, { host: '1.1.1.1', port: 443 });
      socks = true;
      socksOk += 1;
    } catch (_) {}

    const api = socks ? await anyOk(px, API) : { ok: false };
    const dc = socks ? await anyOk(px, DC) : { ok: false };
    if (api.ok) apiOk += 1;
    if (dc.ok) {
      dcOk += 1;
      dcLines.push(
        `socks5://${encodeURIComponent(px.userId)}:${encodeURIComponent(px.password)}@${px.host}:${px.port}`,
      );
    }

    let eg = { ip: '-', country: '-' };
    if (socks && egressSamples < 3) {
      eg = await egress(px);
      egressSamples += 1;
    }

    let verdict = 'DEAD';
    if (dc.ok) verdict = 'DC_OK';
    else if (api.ok) verdict = 'API_ONLY';
    else if (socks) verdict = 'SOCKS_ALIVE_NO_TG';

    console.log(
      verdict,
      px.label,
      `socks=${socks | 0}`,
      `api=${api.ok | 0}`,
      `dc=${dc.ok | 0}`,
      eg.ip && eg.ip !== '-'
        ? `egress=${eg.ip}/${eg.country || '?'}/${(eg.org || '').slice(0, 24)}`
        : '',
    );
  }

  console.log('---');
  console.log(
    JSON.stringify({
      total: list.length,
      SOCKS_OK: socksOk,
      API_TG_OK: apiOk,
      DC_OK: dcOk,
      DC_RATE: list.length ? +(dcOk / list.length).toFixed(2) : 0,
    }),
  );
  if (dcLines.length) {
    console.log('DC_OK_LINES');
    for (const l of dcLines) console.log(l);
  }
  process.exit(dcOk > 0 ? 0 : 2);
})().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
