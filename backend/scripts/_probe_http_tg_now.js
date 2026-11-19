#!/usr/bin/env node
const net = require('net');

const RAW = `
45.139.54.158:63513:66uC85M2ZJU5:xyFuQApb5NgB
92.119.161.150:62657:66uC85M2ZJU5:xyFuQApb5NgB
45.147.1.200:62509:66uC85M2ZJU5:xyFuQApb5NgB
193.201.127.216:63401:66uC85M2ZJU5:xyFuQApb5NgB
194.104.237.233:63253:66uC85M2ZJU5:xyFuQApb5NgB
185.207.213.38:64029:66uC85M2ZJU5:xyFuQApb5NgB
104.164.205.112:63647:66uC85M2ZJU5:xyFuQApb5NgB
104.164.209.27:62913:66uC85M2ZJU5:xyFuQApb5NgB
130.49.17.174:62565:66uC85M2ZJU5:xyFuQApb5NgB
155.212.34.47:64393:66uC85M2ZJU5:xyFuQApb5NgB
138.249.212.178:63683:66uC85M2ZJU5:xyFuQApb5NgB
`.trim();

const list = RAW.split(/\n/).map((line) => {
  const [host, port, user, pass] = line.trim().split(':');
  return { host, port: +port, user, pass };
});

const dest = { host: '149.154.167.51', port: 443 };

function probeHttp(px) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: px.host, port: px.port });
    let buf = '';
    let done = false;
    const finish = (ok, msg) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch (_) {}
      resolve({ ok, msg });
    };
    sock.setTimeout(8000, () => finish(false, 'timeout'));
    sock.on('connect', () => {
      const auth = Buffer.from(`${px.user}:${px.pass}`).toString('base64');
      sock.write(
        `CONNECT ${dest.host}:${dest.port} HTTP/1.1\r\n` +
          `Host: ${dest.host}:${dest.port}\r\n` +
          `Proxy-Authorization: Basic ${auth}\r\n` +
          `\r\n`,
      );
    });
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      if (buf.includes('\r\n\r\n')) {
        const line = buf.split('\r\n')[0];
        finish(/^HTTP\/1\.\d 200/i.test(line), line.slice(0, 90));
      }
    });
    sock.on('error', (e) => finish(false, String(e.message).slice(0, 70)));
  });
}

const fs = require('fs');
const out = [];
function log(...a) {
  const line = a.join(' ');
  out.push(line);
  console.log(line);
}

(async () => {
  log('HTTP_PROBE_START', String(list.length));
  let ok = 0;
  for (const px of list) {
    const r = await probeHttp(px);
    log(r.ok ? 'HTTP_OK' : 'HTTP_FAIL', `${px.host}:${px.port}`, r.msg);
    if (r.ok) ok += 1;
  }
  log('HTTP_OK_TOTAL', ok, '/', list.length);
  fs.writeFileSync('/tmp/http_probe_out.txt', out.join('\n') + '\n');
})().catch((e) => {
  console.error('HTTP_PROBE_ERR', e);
  process.exit(1);
});
