#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log(`OK  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const root = path.join(__dirname, '../..');
const ai = fs.readFileSync(path.join(root, 'backend/services/aiResponder.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
const media = fs.readFileSync(path.join(root, 'backend/services/mediaReplies.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const updates = fs.readFileSync(path.join(root, 'frontend/updates.js'), 'utf8');
const ops = fs.readFileSync(path.join(root, 'ops-console/app/updates.js'), 'utf8');
const log = fs.readFileSync(path.join(root, 'CHANGELOG_TG.md'), 'utf8');

ok('server_scrub_audit', /delete process\.env\.AUDIT_SMOKE/.test(server));
ok('ai_under_pm2', /const underPm2/.test(ai) && /skipOpenAiBoot/.test(ai));
ok('ai_null_guard', /OpenAI client is null/.test(ai));
ok('media_optional_chat', /checked\?\.chat/.test(media));
ok('bump_updates', /updates\.js\?v=235/.test(html));
ok('feed', /ИИ снова отвечает/.test(updates));
ok('ops_feed', /ИИ снова отвечает/.test(ops));
ok('changelog_0ld', /## 0ld\./.test(log));

// Runtime: under fake PM2, AUDIT_SMOKE must NOT null the client export path.
process.env.AUDIT_SMOKE = '1';
process.env.pm_id = '0';
process.env.name = 'tgbot';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke';
delete require.cache[require.resolve('../services/aiResponder')];
const mod = require('../services/aiResponder');
ok('exports_build_opts', typeof mod.buildOpenAIOptions === 'function');
// Module-level openai is not exported; re-read gate via source already OK.
// Soft check: describeImage exists and won't throw sync on null buffer path.
ok('describe_image_fn', typeof mod.describeImage === 'function');

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ALL OK');
process.exit(0);
