#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cp -f /tmp/externalFacts.js "$ROOT/backend/services/"
cp -f /tmp/updates.js /tmp/index.html "$ROOT/frontend/"
cd "$ROOT/backend"
node -e "
const ef=require('./services/externalFacts');
const samples=['сколько время?','Сколько время','сколько времени?','который час?','какой час'];
for (const s of samples) {
  if (!ef.TIME_ASK_RE.test(s)) { console.error('no match', s); process.exit(1); }
}
// заведомо кривое время → должно переписать на актуальное
const g=ef.groundClockReply('сейчас около 03:17)', 'живёшь в Москве', 'сколько время?');
if (/03:17/.test(g)) { console.error('did not ground', g); process.exit(1); }
if (!/\d{1,2}:\d{2}/.test(g)) { console.error('no clock in', g); process.exit(1); }
console.log('clock_ok', g);
"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
timeout 50 pm2 restart tgbot --update-env
pm2 save
sleep 2
grep -n 'врем(?:я|ени)\|сколько время\|updates.js?v=64' "$ROOT/backend/services/externalFacts.js" "$ROOT/frontend/index.html" "$ROOT/frontend/updates.js" | head -8
echo CLOCK_FIX_OK
