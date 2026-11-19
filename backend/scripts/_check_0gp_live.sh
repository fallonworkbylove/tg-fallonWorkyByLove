#!/bin/bash
echo "=== OUT recent proxy/session ==="
grep -aE '\[proxy\]|активирован|Восстанавливаю|сесс|GramJS|TelegramClient|BOOTSTRAP|online|подключ|завершен|ошибка|Warm TG|tgWeak|clientPool|restore' \
  /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -120
echo "=== ERR recent (no stack) ==="
grep -aE '\[proxy\]|активирован|DEAD|Warm|ошибка|failed|TIMEOUT|markProxy|connect' \
  /root/.pm2/logs/tgbot-error.log 2>/dev/null | grep -v 'at ' | tail -60
echo "=== process uptime ==="
pm2 describe tgbot | grep -E 'status|uptime|restarts|pid' | head -20
echo "=== alive candidates now (node) ==="
cd /root/opt/tgbot/tg-miniapp-loverussian/backend && node -e '
const pp = require("./services/proxyPools");
const all = pp.getWorkPool ? pp.getWorkPool() : (pp.PROXY_POOL || []);
const list = Array.isArray(all) ? all : [];
console.log("pool", list.length);
const alive = typeof pp.getAliveWorkProxies === "function" ? pp.getAliveWorkProxies()
  : (typeof pp.listCandidates === "function" ? pp.listCandidates() : list);
console.log("candidates_fn", typeof pp.getAliveWorkProxies, typeof pp.listCandidates, typeof pp.getWorkCandidates);
const keys = Object.keys(pp).filter(k => /proxy|alive|work|warm|dead|candidate/i.test(k));
console.log("exports", keys.join(","));
' 2>&1 | head -40
