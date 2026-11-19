#!/usr/bin/env node
require('dotenv').config();
const OpenAI = require('openai');
const { buildOpenAIOptions } = require('../services/aiResponder');

(async () => {
  const client = new OpenAI({ ...buildOpenAIOptions(), maxRetries: 0, timeout: 45000 });
  const t0 = Date.now();
  try {
    const r = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping — ответь одним словом ok' }],
      max_tokens: 5,
    });
    console.log('OK', Date.now() - t0, 'ms', (r.choices[0].message.content || '').trim());
    process.exit(0);
  } catch (e) {
    console.error('FAIL', Date.now() - t0, 'ms', e.message);
    process.exit(1);
  }
})();
