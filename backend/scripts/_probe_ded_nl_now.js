#!/usr/bin/env node
const { SocksClient } = require('socks');

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

const dests = [
  { host: '149.154.167.51', port: 443 },
  { host: '149.154.175.54', port: 443 },
];

const list = RAW.split(/\n/).map((line) => {
  const [host, port, userId, password] = line.trim().split(':');
  return { host, port: +port, userId, password };
});

(async () => {
  let ok = 0;
  for (const px of list) {
    let good = false;
    let lastErr = '';
    for (const destination of dests) {
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
          timeout: 8000,
        });
        info.socket.destroy();
        good = true;
        break;
      } catch (e) {
        lastErr = String(e.message || e).slice(0, 60);
      }
    }
    if (good) {
      ok += 1;
      console.log('TG_OK', `${px.host}:${px.port}`);
    } else {
      console.log('TG_FAIL', `${px.host}:${px.port}`, lastErr);
    }
  }
  console.log('TG_OK_TOTAL', ok, '/', list.length);
})();
