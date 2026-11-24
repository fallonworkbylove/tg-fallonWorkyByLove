'use strict';
/**
 * Smoke 0t1: роутер Light/Complex + normalize OpenRouter model ids.
 */
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
process.env.OPENAI_MODEL_LIGHT = 'qwen/qwen3.7-flash';
process.env.OPENAI_MODEL_COMPLEX = 'openai/gpt-5.6-luna';
process.env.OPENAI_MODEL_FALLBACK = 'qwen/qwen3.7-flash';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';

const path = require('path');
const ar = require(path.join(__dirname, '../services/aiResponder'));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(ar.LIGHT_MODEL === 'qwen/qwen3.7-flash', 'light');
assert(ar.COMPLEX_MODEL === 'openai/gpt-5.6-luna', 'complex');
assert(ar.normalizeModelId('gpt-4o-mini') === 'openai/gpt-4o-mini', 'normalize prefix');
assert(ar.pickChatModel([], 'привет', {}) === ar.LIGHT_MODEL, 'short light');
assert(ar.pickChatModel([], 'x'.repeat(130), {}) === ar.COMPLEX_MODEL, 'long complex');
assert(
  ar.pickChatModel(new Array(12).fill({ role: 'user', content: 'hi' }), 'ок', {}) ===
    ar.COMPLEX_MODEL,
  'deep complex',
);
assert(ar.pickChatModel([], 'ок', { forceComplex: true }) === ar.COMPLEX_MODEL, 'force complex');
assert(ar.getAnalysisModel() === ar.COMPLEX_MODEL, 'analysis');
assert(ar.reasoningOptionsForModel('qwen/qwen3.7-flash').reasoning.effort === 'none', 'qwen no-think');
assert(ar.reasoningOptionsForModel('openai/gpt-5.6-luna').reasoning.effort === 'low', 'luna low');

const { getPricing } = require(path.join(__dirname, '../services/finetuneUsage'));
assert(getPricing('openai/gpt-5.6-luna').input === 0.2, 'luna price');
assert(getPricing('qwen/qwen3.7-flash').input === 0.03, 'qwen price');

console.log('SMOKE_0t1_OK');
process.exit(0);
