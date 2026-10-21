#!/usr/bin/env node
/**
 * Дешёвое самообучение: match «Учить», стиль prefs, human-style filter.
 * Без живой БД/OpenAI — только чистые функции.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const learningDb = require('../services/learningDb');

let failed = 0;
function check(name, ok, detail) {
  console.log(name, ok ? 'OK' : 'FAIL');
  if (!ok) {
    failed += 1;
    if (detail != null) console.log(' ', detail);
  }
}

check(
  'boost_substring',
  learningDb.exampleScoreBoosted('скинь номер', 'скинь номер поболтаем') >
    learningDb.exampleScore('скинь номер', 'скинь номер поболтаем'),
);

check(
  'boost_weak_still_positive',
  learningDb.exampleScoreBoosted('как дела?', 'ну как дела у тебя') > 0.08,
);

check('human_ok', learningDb.isHumanStyleReply('поняла) ну ок') === true);
check('human_meet_block', learningDb.isHumanStyleReply('скоро увидимся)') === false);
check('human_essay_block', learningDb.isHumanStyleReply('действительно может помочь всегда') === false);

// mergeUniquePatterns via buildLearningSnippet shape — just ensure exports
check('exports_scope', typeof learningDb.getScopedBestPatterns === 'function');
check('exports_snippet', typeof learningDb.buildLearningSnippet === 'function');

if (failed) {
  console.log('FAILED', failed);
  process.exit(1);
}
console.log('ALL OK');
