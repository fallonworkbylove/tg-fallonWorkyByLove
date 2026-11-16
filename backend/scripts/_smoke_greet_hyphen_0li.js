#!/usr/bin/env node
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-0li';
const soft = require('../services/softHumanLite');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
  console.log('OK', msg);
}

const GREET = 'При-вет' + String.fromCodePoint(0x1f596);
assert(soft.isBareGreeting(GREET), 'hyphen+emoji greeting');
assert(soft.isBareGreeting('привет)'), 'plain greeting');
assert(!soft.isBareGreeting('/start'), 'slash not greeting');

const g = soft.fixAckOnBareGreeting('мм, поняла)', GREET);
assert(/привет|хай/i.test(g) && !/поняла/i.test(g), `ack on hyphen greet → ${g}`);

const s = soft.fixSlashCommandReply('собираюсь, но ещё тут)', '/start');
assert(!/собира/i.test(s), `slash → ${s}`);

const q = soft.fixDayTalkOnBareQuestion('эм, сейчас дома, жду посылку))', '?');
assert(!/посылк|дома/i.test(q), `bare ? → ${q}`);

const pipe = soft.applySoftLite('мм, поняла)', [], GREET);
assert(/привет|хай/i.test(pipe), `applySoftLite greet → ${pipe}`);

console.log('SMOKE_0li_OK');
process.exit(0);
