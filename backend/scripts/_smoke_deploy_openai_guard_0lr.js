#!/usr/bin/env node
/** Smoke: fake OPENAI keys must be refused by guard logic. */
const assert = require('assert');

function isFakeOpenAiKey(key) {
  const k = String(key || '');
  return (
    !k ||
    k.length < 20 ||
    k === 'sk-deploy' ||
    k === 'sk-a' ||
    k === 'sk-test' ||
    k.startsWith('sk-deploy') ||
    k.startsWith('sk-audit') ||
    k.startsWith('sk-test')
  );
}

assert.strictEqual(isFakeOpenAiKey('sk-deploy'), true);
assert.strictEqual(isFakeOpenAiKey('sk-audit-c'), true);
assert.strictEqual(isFakeOpenAiKey('sk-test'), true);
assert.strictEqual(isFakeOpenAiKey(''), true);
assert.strictEqual(isFakeOpenAiKey('sk-proj-nfZFxxxxxxxxxxxxxxxx'), false);
assert.strictEqual(isFakeOpenAiKey('sk-xxxxxxxxxxxxxxxxxxxxxxx'), false);

console.log('OK smoke_deploy_openai_guard_0lr');
process.exit(0);
