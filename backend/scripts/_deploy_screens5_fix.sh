#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
B="$ROOT/backend"
F="$ROOT/frontend"

cp -f /tmp/nftCampaign.js /tmp/objectionHandler.js /tmp/personaFacts.js \
  /tmp/dailyPhotos.js /tmp/externalFacts.js /tmp/replyPipeline.js /tmp/aiResponder.js \
  "$B/services/"
cp -f /tmp/updates.js /tmp/index.html "$F/"

cd "$B"
# Не травить OPENAI_API_KEY=sk-test — брать из .env
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
if [ -z "$KEY" ] || [[ "$KEY" == sk-test* ]]; then
  echo "BAD_OPENAI_KEY"
  exit 1
fi
export OPENAI_API_KEY="$KEY"
# профит-скрины выкл явно
unset DAILY_PHOTO_ENABLED || true

node -e "
const nft=require('./services/nftCampaign');
const oh=require('./services/objectionHandler');
const pf=require('./services/personaFacts');
const ef=require('./services/externalFacts');
const phrases=nft.WORK_PROBLEM_PHRASES_RU || null;
// pick via maybe path — phrases not exported; smoke strip + fake + geo
const stripped=nft.stripSoftPitchOffer('ну работаю онлайн, могу показать если интересно без давления)');
if(/могу показать|без давления/i.test(stripped)) { console.error('fail strip', stripped); process.exit(1); }
const fake=oh.softenFakeAccusationReply('да-да я слушаю)', 'ты фейк?');
if(/слушаю/i.test(fake)) { console.error('fail fake', fake); process.exit(1); }
const prompt='ты живёшь в Таганроге, переезжаешь в Белгород к маме, ей нужна поддержка';
const card=pf.parsePersonaCard(prompt);
if(!card.toCity||!/белгород/i.test(card.toCity)) { console.error('fail card', card); process.exit(1); }
const g=pf.groundReply('а в Белгороде, хм, просто надо', 'Для чего переезжаешь в такой неспокойный город?', [{role:'assistant',content:'переезжаю к маме'}], prompt);
if(/просто надо/i.test(g)||!/маме/i.test(g)) { console.error('fail geo', g); process.exit(1); }
const hint=oh.getMoveBackstoryHint('why_move', {systemPrompt:prompt});
if(!/Белгород/i.test(hint)||!/просто надо/i.test(hint)) { console.error('fail hint', hint); process.exit(1); }
console.log('smoke_ok', stripped, '|', fake, '|', g);
"

timeout 50 pm2 restart tgbot --update-env
pm2 save
sleep 3
echo "pid=$(pm2 pid tgbot)"
grep -n 'пошла решать проблему\|DAILY_PHOTO_ENABLED\|Живее по скринам\|просто надо\|softenFakeAccusationReply\|groundClockReply' \
  "$B/services/nftCampaign.js" "$B/services/dailyPhotos.js" "$B/services/objectionHandler.js" \
  "$B/services/externalFacts.js" "$F/updates.js" "$F/index.html" | head -20

echo "=== AUDIT 1 ==="
AUDIT_FIX_SINCE='2026-10-28 18:00:00' node scripts/_ultra_hard_audit.js | tee /tmp/aud_s5_1.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|findings.: \[' || true
echo "=== AUDIT 2 ==="
AUDIT_FIX_SINCE='2026-10-28 18:00:00' node scripts/_ultra_hard_audit.js | tee /tmp/aud_s5_2.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|findings.: \[' || true
echo "=== AUDIT 3 ==="
AUDIT_FIX_SINCE='2026-10-28 18:00:00' node scripts/_ultra_hard_audit.js | tee /tmp/aud_s5_3.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|findings.: \[' || true

node <<'NODE'
const fs=require('fs');
function parse(p){
  const t=fs.readFileSync(p,'utf8');
  const i=t.indexOf('{'); const j=t.lastIndexOf('}');
  return JSON.parse(t.slice(i,j+1));
}
for (const n of [1,2,3]) {
  const a=parse(`/tmp/aud_s5_${n}.txt`);
  console.log(`audit${n}`, { overall:a.overall, checks:a.checks, findings:(a.findings||[]).length, score:a.score });
}
NODE
echo SCREENS5_DEPLOY_OK
