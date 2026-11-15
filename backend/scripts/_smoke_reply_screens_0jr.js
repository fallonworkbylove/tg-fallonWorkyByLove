/**
 * Smoke 0jr: баги со скринов — где живёшь≠кофе, настроение≠раскрой, чем ты≠поняла.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const fs = require('fs');
const path = require('path');
const thin = require('../services/humanThinLayer');

const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('OK', m);
};

const prompt =
  'Ты Милана. Живу в Липецке, переезжаю в Амурск. Сборы, к маме.';

// Семен: «где живёшь?» → нельзя оставить «кофе пью»
const whereOut = thin.fixDirectFactAsk(
  'ничего особенного, кофе пью)',
  'А ты где живёшь?',
  prompt,
);
assert(!/кофе\s+пью|сериал\s+фоном|просто\s+отдыхаю/i.test(whereOut), 'where no activity filler');
assert(/липецк|амурск|пока|дома|еду|тут|из\s+/i.test(whereOut), 'where→geo-ish answer');

// Саймон: «как настроение?» + слабый ответ → не «раскрой»
const moodOut = thin.fixWeakQuestionReply('поняла)', 'Как настроение ?)');
assert(!/раскрой/i.test(moodOut), 'mood no раскрой');
assert(/норм|ровн|ок|нормальн/i.test(moodOut), 'mood soft answer');

// Семен: «а чем ты?» + «поняла)» → не голое поняла / не раскрой
const chemOut = thin.fixWeakQuestionReply('поняла)', 'Ага, а чем ты?');
assert(!/^поняла\s*\)?$/i.test(chemOut.trim()), 'chem not bare поняла');
assert(!/раскрой/i.test(chemOut), 'chem no раскрой');

// Move-spam не режет гео/почему город
const src = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/USER_ASKED_GEO_RE/.test(src), 'geo guard in move-spam');
assert(src.includes('почему\\s+(?:именно\\s+)?'), 'why-city in USER_ASKED_MOVE');

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_REPLY_SCREENS_0JR_OK');
process.exit(process.exitCode || 0);
