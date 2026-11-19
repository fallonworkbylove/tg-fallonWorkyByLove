#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend || exit 1
node <<'NODE'
const {execSync}=require('child_process');
const d=JSON.parse(execSync('pm2 jlist',{encoding:'utf8'}));
const e=d.find(x=>x.name==='tgbot').pm2_env;
const pl=String(e.PROXY_LIST||'').split(';').filter(Boolean);
const opl=String(e.OPENAI_PROXY_LIST||'').split(';').filter(Boolean);
console.log(JSON.stringify({
  PROXY: pl.length,
  OPENAI_PROXY: opl.length,
  first3: pl.slice(0,3),
  openaiFirst: opl.slice(0,5),
}, null, 2));
NODE
echo "--- dead notebook ---"
wc -l config/proxies-dead.txt config/proxies-openai-ok.txt 2>/dev/null
tail -5 config/proxies-openai-ok.txt 2>/dev/null
echo "--- recent mark dead / failover ---"
grep -aE 'markProxyDead|proxy failover|openai.*fail|skip dead|proxy dead' /root/.pm2/logs/tgbot-out.log | tail -25
grep -aE 'markProxyDead|proxy failover|SocksClient|Connection error' /root/.pm2/logs/tgbot-error.log | tail -15
