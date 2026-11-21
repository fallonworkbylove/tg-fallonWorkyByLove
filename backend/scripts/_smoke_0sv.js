#!/usr/bin/env node
'use strict';
const path = require('path');
const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
  console.log('OK', m);
};

const ma = require(path.join(__dirname, '../services/messageAnalysis'));

assert(ma.detectSpeechAct('Приветствую') === 'greeting', 'act greeting');
assert(ma.detectSpeechAct('где ты живёшь?') === 'question', 'act question');
assert(ma.detectSpeechAct('ты ебнутая') === 'insult', 'act insult');
assert(ma.detectSpeechAct('сегодня завал устал') === 'tired', 'act tired');
assert(ma.detectTopics('где живёшь?').includes('location'), 'topic location');
assert(ma.detectTopics('тебе сколько лет?').includes('age'), 'topic age');
assert(ma.detectTopics('типа трейдинг?').includes('job'), 'topic job');
assert(ma.detectEmotion('ты дура') === 'angry', 'emo angry');
assert(ma.detectEmotion('приятно с тобой') === 'warm', 'emo warm');

const aGreet = ma.analyzeIncoming('Приветствую', []);
assert(aGreet.herMood === 'warm_hello', `mood hello → ${aGreet.herMood}`);

const hintLoc = ma.buildAnalysisHint('где ты живёшь?', []);
assert(hintLoc && /ОБЯЗАТЕЛЬНО/i.test(hintLoc) && /город|жив/i.test(hintLoc), `hint loc → ${hintLoc.slice(0, 120)}`);
assert(/НЕЛЬЗЯ/i.test(hintLoc) && /кофе|особенного/i.test(hintLoc), 'forbid offtopic');

const hintGreet = ma.buildAnalysisHint('привет', []);
assert(/приветств/i.test(hintGreet) && /а дальше/i.test(hintGreet), 'hint greet forbid a дальше');

const hintQ = ma.buildAnalysisHint('а где планируешь?', []);
assert(/прямой ответ|по сути/i.test(hintQ), 'hint question must answer');

const mood = ma.buildMoodOverride('сегодня завал устал', []);
assert(/забот|мягк/i.test(mood), `mood tired → ${mood}`);

const frag = ma.buildSoftHintFragment('У тебя тут работа, родня, знакомые?', []);
assert(frag && /важн|работ|родн/i.test(frag), `frag roots → ${frag}`);

const soft = require(path.join(__dirname, '../services/softHumanLite'));
const sh = soft.softHint([], 'где живёшь?');
assert(/РАЗБОР РЕПЛИКИ|город|жив/i.test(sh), 'softHint has analysis');

const thin = require(path.join(__dirname, '../services/humanThinLayer'));
const th = thin.buildThinHumanHint('где живёшь?', []);
assert(/вопрос|сути|город|якорь/i.test(th), 'thin hint wired');

const aiSrc = require('fs').readFileSync(
  path.join(__dirname, '../services/aiResponder.js'),
  'utf8',
);
assert(/buildAnalysisHint/.test(aiSrc) && /buildMoodOverride/.test(aiSrc), 'aiResponder wired');

console.log('SMOKE_0SV_OK');
process.exit(0);
