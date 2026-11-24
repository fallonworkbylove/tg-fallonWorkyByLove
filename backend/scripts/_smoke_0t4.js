'use strict';
/**
 * Smoke 0t4: контекст 90 + долгосрочная identity-память + живность.
 */
process.env.AUDIT_SMOKE = '1';

const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Без require тяжёлых сервисов (db/proxy) — только исходники + лёгкий eval паттернов.
const histSrc = fs.readFileSync(path.join(__dirname, '../services/history.js'), 'utf8');
assert(/HISTORY_LIMIT = 90/.test(histSrc), 'history ~90');

const src = fs.readFileSync(path.join(__dirname, '../services/memoryTriggers.js'), 'utf8');
assert(/IDENTITY_FACT_TYPES/.test(src), 'identity set');
assert(/type: 'age'/.test(src), 'age pattern');
assert(/INTERVAL 120 DAY/.test(src), 'long-term 120d');
assert(/backfillIdentityFromHistory/.test(src), 'backfill export');
assert(/fact_type NOT IN \('name','age','city','work'\)/.test(src), 'prune keeps identity');

const nameIntro =
  /(?:меня\s+зовут|мо[её]\s+имя|зови\s+меня)\s+([А-ЯЁA-Z][а-яёa-zЁё]{2,15})(?:\s|$|[),.!?])/i;
const nameYa = /(?:^|[.!?]\s+|\s)Я\s+([А-ЯЁA-Z][а-яёa-zЁё]{2,15})(?:\s|$|[),.!?])/;
assert(nameIntro.test('меня зовут Артём'), 'name match');
assert(nameYa.test('Я Максим'), 'name ya capital');
assert(!nameIntro.test('я думаю что'), 'no name from думаю intro');
assert(!nameYa.test('я думаю что'), 'no name from думаю ya');
assert(/skipPrefs/.test(src), 'backfill skipPrefs guard');
const ageRe = /(?:мне|мне\s+уже)\s+(\d{2})\s*(?:год|лет)|(?:^|\s)я\s+(\d{2})\s*(?:год|лет)|(?:мне)\s+(\d{2})(?:\s|$|[),.!?])/i;
assert(ageRe.test('мне 28 лет'), 'age match');
assert(ageRe.test('я 32 года'), 'age ya');

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
assert((pipe.match(/backfillIdentityFromHistory/g) || []).length >= 2, 'pipeline wires backfill x2');

const ar = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/Живость:|обратись по имени/i.test(ar), 'alive style');

const pp = fs.readFileSync(path.join(__dirname, '../services/peerProfile.js'), 'utf8');
assert(/MAX_HISTORY_TURNS = 24/.test(pp), 'peer profile window');
assert(/имя\/возраст|возраст:28/i.test(pp), 'peer profile facts');

console.log('SMOKE_0t4_OK');
process.exit(0);
