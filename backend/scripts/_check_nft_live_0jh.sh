#!/bin/bash
set +e
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','OPENAI_API_KEY']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
echo '=== diag ==='
timeout 40 node scripts/_diag_nft_now.js
echo '=== logs NFT ==='
grep -aE 'NFT|nft\.ogg|Перед NFT|голосовое про NFT|nft_pending|nft_voice|work_mention|NFT-кампани' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -40
echo '=== err NFT ==='
grep -aE 'NFT|nft\.ogg|nft_voice' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -15
echo '=== file ==='
ls -la voices/nft.ogg 2>/dev/null || ls -la ../voices/nft.ogg 2>/dev/null || find /root/opt/tgbot/tg-miniapp-loverussian -name 'nft.ogg' 2>/dev/null | head -5
echo NFT_CHECK_DONE
