#!/bin/bash
# Status + optional re-warm with longer timeout under pm2 env
set -e
APP=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$APP"

echo "=== uptime / PROXY_LEN ==="
pm2 jlist | python3 -c '
import json,sys
j=json.load(sys.stdin)
p=[x for x in j if x["name"]=="tgbot"][0]
pl=p["pm2_env"].get("PROXY_LIST") or ""
print("pm2_PROXY_LEN", len([x for x in pl.split(";") if x.strip()]))
print("status", p["pm2_env"]["status"])
print("pid", p.get("pid"))
print("restarts", p["pm2_env"].get("restart_time"))
'

echo "=== activated / fail since last boot (pid log window) ==="
# last 200 matching lines
grep -aE 'активирован|Не удалось подключить|Восстанавливаю|Warm TG:|завершен|ошибка подключ|Счетчик|BOOTSTRAP|сессии восстанов' \
  /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -80

echo "=== DEAD unique hosts (recent) ==="
grep -aO 'DEAD socks5 [^ ]+' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -40 | sort | uniq -c | sort -rn | head -30

echo "=== standalone warm probe (pm2 PROXY_LIST, timeout 12s) ==="
# Export PROXY_LIST from pm2 into this shell
eval "$(pm2 jlist | python3 -c '
import json,sys,shlex
j=json.load(sys.stdin)
p=[x for x in j if x["name"]=="tgbot"][0]
pl=p["pm2_env"].get("PROXY_LIST") or ""
print("export PROXY_LIST="+shlex.quote(pl))
')"
# Clear login file noise somewhat; use env only for work
export PROXY_LIST_LOGIN="${PROXY_LIST_LOGIN:-}"
node <<'NODE'
const path = require('path');
// fresh require of proxyPools with current env
delete require.cache[require.resolve('./services/proxyPools')];
const pp = require('./services/proxyPools');
(async () => {
  const r = await pp.warmProbeWorkProxies({ timeoutMs: 12000, concurrency: 3 });
  console.log('WARM_RESULT', JSON.stringify(r));
  const pool = pp.PROXY_POOL;
  const ok = [];
  const weak = [];
  for (const p of pool) {
    const k = pp.proxyKey(p);
    if (pp.isTgWeak && pp.isTgWeak(p)) weak.push(k);
    else ok.push(k);
  }
  // isTgWeak after warm: failList marked weak, okList not
  console.log('OK_HOSTS', ok.join(','));
  console.log('WEAK_HOSTS', weak.join(','));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE
