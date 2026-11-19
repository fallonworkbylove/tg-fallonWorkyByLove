#!/bin/bash
# Keep only SOCKS that passed _probe_socks_tg.js (WORKING_INDEXES).
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
ENV=.env
# Working from last probe: 0,1,2,3,4,11,14,15,16
ALIVE='socks5:209.127.51.109:8000:QbQaXK:LMF5Dm;socks5:23.229.75.249:8000:QbQaXK:LMF5Dm;socks5:154.30.136.63:8000:QbQaXK:LMF5Dm;socks5:173.209.232.164:8000:QbQaXK:LMF5Dm;socks5:173.209.233.42:8000:QbQaXK:LMF5Dm;socks5:168.81.66.214:8000:nFBMNd:QEntaw;socks5:72.56.182.199:8000:QbQaXK:LMF5Dm;socks5:72.56.184.168:8000:QbQaXK:LMF5Dm;socks5:72.56.181.78:8000:QbQaXK:LMF5Dm'

cp -a "$ENV" "${ENV}.bak.proxyfix.$(date +%s)"
python3 - <<PY
from pathlib import Path
p = Path('.env')
text = p.read_text(encoding='utf-8', errors='replace')
alive = '''$ALIVE'''
import re
if re.search(r'^PROXY_LIST=', text, re.M):
    text2 = re.sub(r'^PROXY_LIST=.*$', 'PROXY_LIST=' + alive, text, count=1, flags=re.M)
else:
    text2 = text.rstrip() + '\nPROXY_LIST=' + alive + '\n'
p.write_text(text2, encoding='utf-8')
print('PROXY_LIST rewritten, alive=', alive.count('socks5:'))
PY

# Also fill proxies.txt for file pool (one per line, no comments-only)
{
  echo '# auto: alive work proxies'
  echo "$ALIVE" | tr ';' '\n'
} > config/proxies.txt

pm2 restart tgbot --update-env
sleep 8
pm2 describe tgbot | head -8
echo FIX_PROXY_DONE
