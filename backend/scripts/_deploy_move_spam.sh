#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
B="$ROOT/backend"
F="$ROOT/frontend"

cp -f /tmp/aiResponder.js /tmp/lifeTexture.js /tmp/personaFacts.js "$B/services/"
cp -f /tmp/updates.js /tmp/index.html "$F/"

cd "$B"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
if [ -z "$KEY" ] || [[ "$KEY" == sk-test* ]]; then
  echo "BAD_OPENAI_KEY"
  exit 1
fi
export OPENAI_API_KEY="$KEY"

node <<'NODE'
const fs = require('fs');
const src = fs.readFileSync('services/aiResponder.js', 'utf8');
const pf = fs.readFileSync('services/personaFacts.js', 'utf8');
if (/MOVE_ON_DAY_ASK_CHANCE/.test(src)) { console.error('fail old chance still present'); process.exit(1); }
if (!/а\\s\+у\\s\+тебя/.test(src) && !/а\\s\+у\\s\+тебя/.test(src.replace(/\\\\/g,'\\'))) {
  // check literal in source
}
if (!src.includes('а\\s+у\\s+тебя')) { console.error('fail day_ask a u tebya'); process.exit(1); }
if (!src.includes('rewriteMoveSpamReply')) { console.error('fail rewrite'); process.exit(1); }
if (!src.includes('YOUR_TURN_RE')) { console.error('fail your_turn'); process.exit(1); }
if (!src.includes('AI_INTERVIEW_RE')) { console.error('fail interview'); process.exit(1); }
if (!pf.includes('НЕ пиши про сборы')) { console.error('fail persona dayask'); process.exit(1); }

// Softener behavior via Function extract
const m = src.match(/function rewriteMoveSpamReply\(text\) \{[\s\S]*?\n\}/);
const m2 = src.match(/const MOVE_SPAM_RE =\n  [^;]+;/);
const m3 = src.match(/const MOVE_SPAM_FALLBACKS = \[[\s\S]*?\];/);
const m4 = src.match(/const DAY_ASK_RE =\n  [^;]+;/);
const m5 = src.match(/const USER_ASKED_MOVE_RE =\n  [^;]+;/);
const m6 = src.match(/function softenMoveSpamOnDayAsk\(reply, userMessage, history\) \{[\s\S]*?\n\}/);
if (!m || !m2 || !m3 || !m4 || !m5 || !m6) { console.error('fail extract', !!m, !!m2, !!m3, !!m4, !!m5, !!m6); process.exit(1); }
const fn = new Function(`${m2[0]};${m5[0]};${m4[0]};${m3[0]};${m[0]};${m6[0]}; return { softenMoveSpamOnDayAsk, DAY_ASK_RE, MOVE_SPAM_RE };`);
const { softenMoveSpamOnDayAsk, DAY_ASK_RE, MOVE_SPAM_RE } = fn();
if (!DAY_ASK_RE.test('А у тебя')) { console.error('fail re a u tebya'); process.exit(1); }
if (!MOVE_SPAM_RE.test('собираю вещи, готовлюсь к переезду')) { console.error('fail packing re'); process.exit(1); }
const out = softenMoveSpamOnDayAsk(
  'кайф\nсобираю вещи, готовлюсь к переезду',
  'А у тебя',
  [{ role: 'assistant', content: 'как день прошел?' }],
);
if (MOVE_SPAM_RE.test(out)) { console.error('fail still packing', out); process.exit(1); }
const again = softenMoveSpamOnDayAsk(
  'опять собираю вещи)',
  'ну ок',
  [{ role: 'assistant', content: 'собираю вещи, готовлюсь к переезду' }],
);
if (MOVE_SPAM_RE.test(again)) { console.error('fail repeat packing', again); process.exit(1); }
console.log('smoke_ok', out, '|', again);
NODE

timeout 50 pm2 restart tgbot --update-env
pm2 save
sleep 3
echo "pid=$(pm2 pid tgbot)"
grep -n 'rewriteMoveSpamReply\|YOUR_TURN_RE\|НЕ пиши про сборы\|Без сборов и без допроса\|updates.js?v=69' \
  "$B/services/aiResponder.js" "$B/services/personaFacts.js" "$F/updates.js" "$F/index.html" | head -25
echo DEPLOY_OK
