#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cp -f /tmp/nftCampaign.js "$ROOT/backend/services/"
cd "$ROOT/backend"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
node <<'NODE'
const n = require('./services/nftCampaign');
const s = n.stripSoftPitchOffer(
  'да, раньше тоже не шарила) могу показать, если интересно, без давления)',
);
if (/могу показать|без давления/i.test(s)) {
  console.error('FAIL', s);
  process.exit(1);
}
console.log('strip_ok', s);
NODE
timeout 40 pm2 restart tgbot --update-env
pm2 save
bash /tmp/_mega_status.sh | head -80
