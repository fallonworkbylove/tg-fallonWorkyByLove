#!/usr/bin/env node
/**
 * Probe login residential pool: SOCKS → HTTPS (api.telegram.org) → MTProto DC.
 * Also sample egress IP (ipify) to confirm NL-ish exit.
 * Does NOT need NL VPS: Telegram sees the residential exit IP either way.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { SocksClient } = require('socks');

const FILE =
  process.env.LOGIN_FILE ||
  path.join(__dirname, '..', 'config', 'proxies-login.txt');

const DC = [
  { host: '149.154.167.50', port: 443 },
  { host: '149.154.167.51', port: 443 },
  { host: '149.154.175.54', port: 443 },
  { host: '91.108.56.165', port: 443 },
];
const API_TG = [{ host: 'api.telegram.org', port: 443 }];
const IPIFY = [{ host: 'api.ipify.org', port: 443 }];

function parseLine(line) {
  const s = String(line || '').trim();
  if (!s || s.startsWith('#')) return null;
  if (/^socks5:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return {
        host: u.hostname,
        port: Number(u.port || 1080),
        userId: decodeURIComponent(u.username || ''),
        password: decodeURIComponent(u.password || ''),
        raw: s,
      };
    } catch (_) {
      return null;
    }
  }
  const p = s.replace(/^socks5:\/\//i, '').split(':');
  if (p.length >= 2 && p[0].toLowerCase() === 'socks5') {
    return {
      host: p[1],
      port: Number(p[2]),
      userId: p[3] || '',
      password: p.slice(4).join(':'),
      raw: s,
    };
  }
  if (p.length >= 4) {
    return {
      host: p[0],
      port: Number(p[1]),
      userId: p[2] || '',
      password: p.slice(3).join(':'),
      raw: s,
    };
  }
  return null;
}

async function viaSocks(px, destination, timeout = 9000) {
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
  return info.socket;
}

async function anyOk(px, destinations, timeout = 9000) {
  for (const d of destinations) {
    try {
      const sock = await viaSocks(px, d, timeout);
      try {
        sock.destroy();
      } catch (_) {}
      return { ok: true, dest: `${d.host}:${d.port}` };
    } catch (e) {
      /* try next */
    }
  }
  return { ok: false };
}

function readHttpIp(socket) {
  return new Promise((resolve) => {
    let buf = '';
    const t = setTimeout(() => {
      try {
        socket.destroy();
      } catch (_) {}
      resolve(null);
    }, 8000);
    socket.setEncoding('utf8');
    socket.on('data', (c) => {
      buf += c;
      if (buf.includes('\r\n\r\n')) {
        clearTimeout(t);
        const body = buf.split('\r\n\r\n')[1] || '';
        const ip = (body.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/) || [])[0] || null;
        try {
          socket.destroy();
        } catch (_) {}
        resolve(ip);
      }
    });
    socket.on('error', () => {
      clearTimeout(t);
      resolve(null);
    });
    socket.write(
      'GET / HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n',
    );
  });
}

async function egressIp(px) {
  try {
    const sock = await viaSocks(px, IPIFY[0], 9000);
    return await readHttpIp(sock);
  } catch (_) {
    return null;
  }
}

async function geoHint(ip) {
  if (!ip) return null;
  // lightweight, best-effort; no key
  try {
    const https = require('https');
    const body = await new Promise((resolve, reject) => {
      const req = https.get(
        `https://ipapi.co/${ip}/country/`,
        { timeout: 6000 },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve(b.trim()));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('timeout'));
      });
    });
    if (/^[A-Z]{2}$/.test(body)) return body;
  } catch (_) {}
  return null;
}

function pickSample(all) {
  const seller = all.filter((p) => /proxy-seller|res\./i.test(p.host));
  const sticky = all.filter((p) => /46\.4\.|sessttl/i.test(p.raw + p.userId));
  const other = all.filter((p) => !seller.includes(p) && !sticky.includes(p));
  const take = (arr, n) => {
    if (!arr.length) return [];
    const step = Math.max(1, Math.floor(arr.length / n));
    const out = [];
    for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i]);
    return out;
  };
  // ~8 seller + ~8 sticky + up to 4 other
  const uniq = new Map();
  for (const p of [...take(seller, 8), ...take(sticky, 8), ...take(other, 4)]) {
    uniq.set(`${p.host}:${p.port}:${p.userId}`, p);
  }
  return { seller: seller.length, sticky: sticky.length, other: other.length, sample: [...uniq.values()] };
}

(async () => {
  const lines = fs.readFileSync(FILE, 'utf8').split(/\n/);
  const all = lines.map(parseLine).filter(Boolean);
  const { seller, sticky, other, sample } = pickSample(all);
  console.log(
    JSON.stringify({
      file: FILE,
      total: all.length,
      seller,
      sticky,
      other,
      sample: sample.length,
    }),
  );

  let dcOk = 0;
  let apiOk = 0;
  let socksOk = 0;
  let nl = 0;
  const rows = [];

  for (const px of sample) {
    const label = `${px.host}:${px.port}`;
    let socks = false;
    try {
      // handshake only: connect to a known open port via proxy (1.1.1.1:443)
      const s = await viaSocks(px, { host: '1.1.1.1', port: 443 }, 9000);
      socks = true;
      socksOk += 1;
      try {
        s.destroy();
      } catch (_) {}
    } catch (_) {}

    const api = socks ? await anyOk(px, API_TG) : { ok: false };
    const dc = socks ? await anyOk(px, DC) : { ok: false };
    if (api.ok) apiOk += 1;
    if (dc.ok) dcOk += 1;

    let ip = null;
    let country = null;
    if (socks) {
      ip = await egressIp(px);
      country = await geoHint(ip);
      if (country === 'NL') nl += 1;
    }

    let verdict = 'DEAD';
    if (dc.ok) verdict = 'DC_OK';
    else if (api.ok) verdict = 'API_ONLY';
    else if (socks) verdict = 'SOCKS_ALIVE_NO_TG';

    const row = {
      label,
      user: String(px.userId || '').slice(0, 24),
      verdict,
      socks,
      api: api.ok,
      dc: dc.ok,
      dcDest: dc.dest || null,
      egress: ip,
      country,
    };
    rows.push(row);
    console.log(
      verdict,
      label,
      `socks=${socks | 0}`,
      `api=${api.ok | 0}`,
      `dc=${dc.ok | 0}`,
      `ip=${ip || '-'}`,
      `cc=${country || '-'}`,
    );
  }

  console.log('---');
  console.log(
    JSON.stringify({
      sampled: sample.length,
      SOCKS_OK: socksOk,
      API_TG_OK: apiOk,
      DC_OK: dcOk,
      EGRESS_NL: nl,
      DC_RATE: sample.length ? +(dcOk / sample.length).toFixed(2) : 0,
      note:
        'DC_OK = MTProto path usable for GramJS login. API_ONLY = web API ok but DC blocked (typical residential fail). Egress country is what Telegram sees.',
    }),
  );
  process.exit(dcOk > 0 ? 0 : 2);
})().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
