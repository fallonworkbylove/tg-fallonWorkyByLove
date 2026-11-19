#!/usr/bin/env node
const fs = require('fs');
const tls = require('tls');
const https = require('https');
const { SocksClient } = require('socks');
const { URL } = require('url');

(async () => {
  const line = fs
    .readFileSync('config/proxies-login.txt', 'utf8')
    .split(/\n/)
    .map((s) => s.trim())
    .find((l) => l.includes('proxy-seller') && l.includes(':10002'));
  const sticky = fs
    .readFileSync('config/proxies-login.txt', 'utf8')
    .split(/\n/)
    .map((s) => s.trim())
    .find((l) => l.includes('46.4.139.124') && l.includes(':10000'));

  async function one(label, line) {
    const u = new URL(line);
    const info = await SocksClient.createConnection({
      proxy: {
        host: u.hostname,
        port: +u.port,
        type: 5,
        userId: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
      },
      command: 'connect',
      destination: { host: 'api.ipify.org', port: 443 },
      timeout: 12000,
    });
    const ip = await new Promise((resolve, reject) => {
      const sock = tls.connect(
        { socket: info.socket, servername: 'api.ipify.org', timeout: 10000 },
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
      sock.on('error', reject);
    });
    if (!ip) {
      console.log(label, 'no_ip');
      return;
    }
    const geo = await new Promise((resolve) => {
      https
        .get(`https://ipapi.co/${ip}/json/`, (res) => {
          let x = '';
          res.on('data', (d) => (x += d));
          res.on('end', () => {
            try {
              resolve(JSON.parse(x));
            } catch (_) {
              resolve({ raw: x.slice(0, 120) });
            }
          });
        })
        .on('error', () => resolve(null));
    });
    console.log(
      JSON.stringify({
        label,
        ip,
        country: geo && geo.country_code,
        city: geo && geo.city,
        org: geo && geo.org,
      }),
    );
  }

  await one('seller', line);
  if (sticky) await one('sticky46', sticky);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
