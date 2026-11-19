#!/bin/bash
set -uo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cd "$B/backend"

echo "===== silence/heal ====="
grep -aE 'silenceCatchup|healed|entity fail|resolvePeer|night text|NightTextQuiet' /root/.pm2/logs/tgbot-out.log | tail -40

echo "===== proxy warm ====="
grep -aE 'Warm|PROXY|alive socks|DEAD socks5|openai.*proxy|OPENAI_PROXY|Work-прокси' /root/.pm2/logs/tgbot-out.log | tail -30

echo "===== env flags ====="
python3 <<'PY'
import re
from pathlib import Path
t = Path('.env').read_text(encoding='utf-8', errors='ignore')
def g(k):
  m = re.search(rf'^{k}=(.*)$', t, re.M)
  return m.group(1).strip() if m else ''
print('NODE_ENV', g('NODE_ENV') or '?')
print('CORS_ORIGIN', (g('CORS_ORIGIN') or 'MISSING')[:180])
print('TELEGRAM_AUTH_BYPASS', g('TELEGRAM_AUTH_BYPASS') or 'unset')
print('TELEGRAM_AUTH_BYPASS_FORCE', g('TELEGRAM_AUTH_BYPASS_FORCE') or 'unset')
print('ADMIN_ALERT_CHAT_ID', 'set' if g('ADMIN_ALERT_CHAT_ID') else 'MISSING')
print('BOT_TOKEN', 'set' if g('BOT_TOKEN') else 'MISSING')
PY

echo "===== nginx ops subdomain ====="
dig +short ops-loverussian.duckdns.org A || true
dig +short loverussian.duckdns.org A || true
curl -s -o /dev/null -w 'http_ops_sub=%{http_code}\n' --max-time 8 http://ops-loverussian.duckdns.org/ || echo http_ops_sub=ERR
curl -s -o /dev/null -w 'https_ops_sub=%{http_code}\n' --max-time 8 https://ops-loverussian.duckdns.org/ || echo https_ops_sub=ERR
ls /etc/letsencrypt/live/ 2>/dev/null || true

echo "===== pm2 proxy sample first 3 ====="
pm2 jlist | python3 -c '
import json,sys
j=json.load(sys.stdin)
p=[x for x in j if x["name"]=="tgbot"][0]
pl=(p["pm2_env"].get("PROXY_LIST")or"").split(";")
oa=(p["pm2_env"].get("OPENAI_PROXY_LIST")or"").split(";")
print("proxy_n", len([x for x in pl if x.strip()]))
print("openai_n", len([x for x in oa if x.strip()]))
print("proxy_sample", [x.split("@")[-1] if "@" in x else x[:40] for x in pl if x.strip()][:5])
print("openai_sample", [x.split("@")[-1] if "@" in x else x[:40] for x in oa if x.strip()][:5])
'

echo "===== outbound leak last ====="
grep -ac 'leak=1' /root/.pm2/logs/tgbot-out.log || echo 0
grep -ac 'leak=0' /root/.pm2/logs/tgbot-out.log || echo 0
grep -aE 'это я|бород' /root/.pm2/logs/tgbot-out.log | tail -8 || true

echo "===== recent replies sample ====="
grep -aE 'Ответ для|→ ' /root/.pm2/logs/tgbot-out.log | tail -25 || true
