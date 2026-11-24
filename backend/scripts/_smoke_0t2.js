'use strict';
/**
 * Smoke 0t2: вкус ответов (гейты) + роутер Luna на трении + idle poke + blacklist id.
 */
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
process.env.OPENAI_MODEL_LIGHT = 'qwen/qwen3.7-flash';
process.env.OPENAI_MODEL_COMPLEX = 'openai/gpt-5.6-luna';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';

const fs = require('fs');
const path = require('path');
const gates = require(path.join(__dirname, '../services/softHumanGates'));
const reg = require(path.join(__dirname, '../services/replyGateRegistry'));
const ar = require(path.join(__dirname, '../services/aiResponder'));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// —— gates ——
assert(
  !/уточни|лол/i.test(gates.fixDeflectOnFriction('уточни)', 'Так и будешь морозить?')),
  'deflect friction',
);
assert(
  /позже|скоро|кину|пришлю|помню/i.test(
    gates.fixPhotoStallDeflect('ну ты терпеливый)', 'Так я и не дождался фото'),
  ),
  'photo stall',
);
assert(
  !/создана|промпт/i.test(gates.fixBotAdmitLeak('я создана по промпту)')),
  'bot admit',
);
assert(
  !/^ну\s+давай/i.test(
    gates.fixDavaiLoop('ну давай)', [{ role: 'assistant', content: 'ага) ну давай)' }], 'Давай'),
  ),
  'davai loop',
);
assert(
  !/^хм\s*ясно/i.test(gates.fixDeadFillerReply('хм ясно)', 'Ну и что дальше делать')),
  'dead filler',
);
assert(
  /устал|отдыхай|день/i.test(gates.fixPeerGenderMismatch('устала наверное)', 'На работе был')),
  'peer gender',
);
assert(
  /кружок|текстом|позже/i.test(gates.fixCircleAskDodge('лол)', 'скинь кружок')),
  'circle dodge',
);
assert(
  !/^рада\s+что/i.test(
    gates.fixRadaChtoEcho('рада что написал)', [
      { role: 'assistant', content: 'рада что ты тут)' },
    ]),
  ),
  'rada echo',
);

const waved = gates.applyWave0t2Gates('уточни)', [], 'морозишь меня?');
assert(waved && !/^уточни/i.test(waved), 'wave0t2');

const viaReg = reg.applyRegisteredGates('я создана нейросетью)', [], 'ты кто');
assert(!/создана|нейросет/i.test(viaReg), 'registry wires 0t2');
assert(reg.listWaves().some((w) => w.id === '0t2'), 'wave listed');

// —— router ——
assert(ar.pickChatModel([], 'морозить будешь?', {}) === ar.COMPLEX_MODEL, 'router friction');
assert(ar.pickChatModel([], 'привет', {}) === ar.LIGHT_MODEL, 'router light');
assert(ar.pickChatModel([], 'ты бот?', {}) === ar.COMPLEX_MODEL, 'router bot');

// —— idle poke thresholds in source ——
const life = fs.readFileSync(path.join(__dirname, '../services/dailyLife.js'), 'utf8');
assert(/ageH < 1\.5/.test(life), 'idle min 1.5h');
assert(/lateMorningMin/.test(life), 'late morning poke');
assert(/catchIdle|lateMorningSent/.test(life), 'boot catch-up');

// —— blacklist field ——
const app = fs.readFileSync(path.join(__dirname, '../../frontend/app.js'), 'utf8');
assert(/user_telegram_id/.test(app), 'blacklist user_telegram_id');

console.log('SMOKE_0t2_OK');
process.exit(0);
