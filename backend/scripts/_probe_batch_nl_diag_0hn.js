#!/usr/bin/env node
const { SocksClient } = require('socks');
const net = require('net');
const http = require('http');

const line =
  process.argv[2] ||
  '212.80.7.117:10000:package-49b418f6-user-wj6utulTpDGZ-zone-custom-region-nl-session-b9sTQbVl-sessTime-60:002pTufqq';
const p = line.split(':');
const host = p[0];
const port = Number(p[1]);
const user = p[2];
const pass = p.slice(3).join(':');

async function trySocks(label, userId, password) {
  try {
    const info = await SocksClient.createConnection({
      proxy: { host, port, type: 5, userId, password },
      command: 'connect',
      destination: { host: '1.1.1.1', port: 443 },
      timeout: 12000,
    });
    info.socket.destroy();
    console.log('SOCKS5_OK', label);
    return true;
  } catch (e) {
    console.log('SOCKS5_FAIL', label, e.message);
    return false;
  }
}

function tryTcp() {
  return new Promise((resolve) => {
    const s = net.connect({ host, port }, () => {
      console.log('TCP_OK', `${host}:${port}`);
      s.destroy();
      resolve(true);
    });
    s.setTimeout(8000, () => {
      console.log('TCP_TIMEOUT');
      s.destroy();
      resolve(false);
    });
    s.on('error', (e) => {
      console.log('TCP_FAIL', e.message);
      resolve(false);
    });
  });
}

function tryHttpConnect() {
  return new Promise((resolve) => {
    const req = http.request({
      host,
      port,
      method: 'CONNECT',
      path: '1.1.1.1:443',
      headers: {
        'Proxy-Authorization':
          'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
        Host: '1.1.1.1:443',
      },
      timeout: 12000,
    });
    req.on('connect', (res, socket) => {
      console.log('HTTP_CONNECT', res.statusCode);
      try {
        socket.destroy();
      } catch (_) {}
      resolve(res.statusCode === 200);
    });
    req.on('error', (e) => {
      console.log('HTTP_CONNECT_FAIL', e.message);
      resolve(false);
    });
    req.on('timeout', () => {
      console.log('HTTP_CONNECT_TIMEOUT');
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

(async () => {
  console.log({ host, port, userHead: user.slice(0, 40), passLen: pass.length });
  await tryTcp();
  await trySocks('as_given', user, pass);
  // some panels want user without package- prefix quirks / URL-encoded
  await trySocks('url_decoded_noop', decodeURIComponent(user), decodeURIComponent(pass));
  await tryHttpConnect();
})();
