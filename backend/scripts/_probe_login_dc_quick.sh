#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend || exit 1
echo "file_lines=$(grep -c '^socks5' config/proxies-login.txt)"
head -1 config/proxies-login.txt | sed 's/:[^:@]*@/:***@/'
node - <<'NODE'
const { SocksClient } = require('socks');
const fs = require('fs');
const { parseProxyEntry } = require('./services/proxyPools');
const line = fs.readFileSync('config/proxies-login.txt','utf8').split(/\n/).find(l=>l.startsWith('socks5'));
const p = parseProxyEntry(line);
const proxy = { host: p.ip, port: p.port, type: 5, userId: p.username, password: p.password };
const dests = [['149.154.167.50',443],['91.108.56.165',443],['api.telegram.org',443]];
(async () => {
  let dc=0, api=0;
  for (const [host, port] of dests) {
    const t0=Date.now();
    try {
      const i = await SocksClient.createConnection({ proxy, command:'connect', destination:{host,port}, timeout:10000 });
      i.socket.destroy();
      console.log('OK', host, Date.now()-t0+'ms');
      if (host.startsWith('api.')) api++; else dc++;
    } catch(e) {
      console.log('FAIL', host, e.message.slice(0,60), Date.now()-t0+'ms');
    }
  }
  console.log(JSON.stringify({ user: p.username, port: p.port, dc, api, verdict: dc>0?'DC_OK':'DC_DEAD' }));
})();
NODE
