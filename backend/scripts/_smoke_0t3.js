'use strict';
/**
 * Smoke 0t3: мозг — friction/bot_test/media_ask + долг + роутер + idle catch-up.
 */
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
process.env.OPENAI_MODEL_LIGHT = 'qwen/qwen3.7-flash';
process.env.OPENAI_MODEL_COMPLEX = 'openai/gpt-5.6-luna';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';

const fs = require('fs');
const path = require('path');
const ma = require(path.join(__dirname, '../services/messageAnalysis'));
const ar = require(path.join(__dirname, '../services/aiResponder'));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(ma.detectSpeechAct('ты бот?') === 'bot_test', 'act bot_test');
assert(ma.detectSpeechAct('Так и будешь морозить?') === 'friction', 'act friction');
assert(ma.detectSpeechAct('скинь кружок') === 'media_ask', 'act media_ask');
assert(ma.detectSpeechAct('привет') === 'greeting', 'act greeting');

const hint = ma.buildAnalysisHint('не дождался фото', [
  { role: 'assistant', content: 'чуть позже кину фото)' },
  { role: 'user', content: 'ок жду' },
]);
assert(hint && /Долг:/i.test(hint), 'hint debt');
assert(/Вайб:|Ход:/i.test(hint), 'hint core');

const a = ma.analyzeIncoming('На работе был', []);
assert(a.speechAct === 'statement' || a.speechAct === 'tired' || a.facts, 'analyze ok');

assert(ar.pickChatModel([], 'ты бот?', {}) === ar.COMPLEX_MODEL, 'router bot_test');
assert(ar.pickChatModel([], 'морозить?', {}) === ar.COMPLEX_MODEL, 'router friction');
assert(ar.pickChatModel([], 'скинь кружок', {}) === ar.COMPLEX_MODEL, 'router media');
assert(ar.pickChatModel([], 'привет', {}) === ar.LIGHT_MODEL, 'router light');

const life = fs.readFileSync(path.join(__dirname, '../services/dailyLife.js'), 'utf8');
assert(/pickFlag/.test(life) && /одно catch-up|один catch-up/i.test(life), 'idle one catch-up');

const arSrc = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/лёгкий чат \(Qwen\)|сложный ход \(Luna\)/i.test(arSrc), 'model craft');
assert(/своё короткое мнение/i.test(arSrc), 'position');

console.log('SMOKE_0t3_OK');
process.exit(0);
