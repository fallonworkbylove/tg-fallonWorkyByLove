#!/bin/bash
set -euo pipefail
cp -f /tmp/nftCampaign.js /root/opt/tgbot/tg-miniapp-loverussian/backend/services/
bash /tmp/_archive_gap_now.sh
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
timeout 40 pm2 restart tgbot --update-env
echo "watch_lines=$(wc -l < /tmp/mega_watch.tsv)"
pgrep -af mega_audit | head -2 || echo 'mega_done_or_missing'
tail -8 /tmp/mega_watch.tsv
