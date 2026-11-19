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
const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
const ai = fs.readFileSync(path.join(root, 'backend/services/aiResponder.js'), 'utf8');
const guard = fs.readFileSync(path.join(root, 'backend/scripts/_deploy_guard.sh'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const updates = fs.readFileSync(path.join(root, 'frontend/updates.js'), 'utf8');
const ops = fs.readFileSync(path.join(root, 'ops-console/app/updates.js'), 'utf8');
const log = fs.readFileSync(path.join(root, 'CHANGELOG_TG.md'), 'utf8');
const skill = fs.readFileSync(
  path.join(root, '.cursor/skills/loverussian-deploy/SKILL.md'),
  'utf8',
);

ok('health_openai_ready', /openai_ready/.test(server));
ok('health_proxy_len', /proxy_len/.test(server));
ok('health_audit_smoke', /audit_smoke/.test(server));
ok('export_ready', /function isOpenAiClientReady/.test(ai));
ok('export_pool', /function openAiProxyPoolLen/.test(ai));
ok('guard_script', /DEPLOY_GUARD_OK/.test(guard) && /REFUSE_PROXY/.test(guard));
ok('guard_scrub', /AUDIT_SMOKE/.test(guard));
ok('skill_mentions_guard', /_deploy_guard\.sh/.test(skill));
ok('bump_updates', /updates\.js\?v=236/.test(html));
ok('feed', /Защита после выката/.test(updates));
ok('ops_feed', /Защита после выката/.test(ops));
ok('changelog_0le', /## 0le\./.test(log));

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ALL OK');
process.exit(0);
