/**
 * Smoke 0hv: media-after-busy, track stub, city false-there, unique login, tasks API.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const fs = require('fs');
const path = require('path');
const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('OK', m);
};
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const pipe = read('services/replyPipeline.js');
assert(/mediaDebt/.test(pipe), 'fireReengage mediaDebt');
assert(/unfulfilledMediaPromiseCount\(history\) === 0/.test(pipe), 'skip busy on media debt');
assert(/histForMedia/.test(pipe), 'hist before media flags');

const soft = require('../services/softHumanLite');
const cut = soft.softCompleteCut('послушай «Moon» от, тоже классный трек');
assert(cut !== 'послушай «Moon» от, тоже классный трек', `track stub fixed: ${cut}`);
assert(/вспомн|вылетело|забыла|группа/i.test(cut), 'track stub human alt');

const ai = require('../services/aiResponder');
assert(ai.isBrokenChatLine('послушай «Moon» от, тоже классный трек'), 'isBroken track');
assert(!ai.isBrokenChatLine('послушай Moon от The Weeknd)'), 'ok track kept');

const so = require('../services/scaleOps');
assert(typeof so.getPoolRoleCounts().login === 'number', 'login count');
const soSrc = read('services/scaleOps.js');
assert(/new Set\(lines/.test(soSrc), 'unique login lines');
assert(so.PERSONA_TEMPLATES.length >= 4, `templates loaded ${so.PERSONA_TEMPLATES.length}`);
assert(
  so.PERSONA_TEMPLATES.every((t) => t.template && /\{\{NAME\}\}/.test(t.template)),
  'slim templates have {{NAME}}',
);
assert(
  so.PERSONA_TEMPLATES.every((t) => !/ДЕНЬ 1|ДЕНЬ 2|ДЕНЬ 3|3-дневн/i.test(t.prompt || t.template || '')),
  'no day1/2/3 plan in prompt',
);
const alena = so.PERSONA_TEMPLATES.find((t) => t.id === 'alena_ivanovo');
assert(alena && /Алёна/.test(alena.prompt) && /Иваново/.test(alena.prompt), 'alena filled defaults');
const custom = so.fillPersonaTemplate(alena.template, {
  name: 'Катя',
  age: '23',
  fromCity: 'Тула',
  toCity: 'Сочи',
});
assert(/Катя/.test(custom) && /Тула/.test(custom) && /Сочи/.test(custom), 'fillPersonaTemplate works');
const nft = read('services/nftCampaign.js');
assert(/ageHours < 24|2-й день|voiceAfterHours/.test(nft), 'nft day logic in code');

// city: false already in dest
const swapped = ai.fixSwappedCurrentCity(
  'я сейчас в Анапе)',
  'как дела?',
  [{ role: 'assistant', content: 'пока в Липецке, в Анапу переезжаю)' }],
  'Ты Маша из Липецка, переезжаешь в Анапу к маме',
);
assert(
  /липецк|пока/i.test(swapped) && !/^я сейчас в Анапе/i.test(swapped),
  `city false-there fixed: ${swapped}`,
);

const acc = read('routes/accounts.js');
assert(/worker-tasks/.test(acc) && /closeTask/.test(acc), 'tasks API');
const fe = read('../frontend/index.html');
assert(/worker-tasks-list/.test(fe), 'tasks UI');
const app = read('../frontend/app.js');
assert(/loadWorkerTasks/.test(app) && /done-task/.test(app), 'tasks JS');

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_HELP_0HV_OK');
process.exit(process.exitCode || 0);
