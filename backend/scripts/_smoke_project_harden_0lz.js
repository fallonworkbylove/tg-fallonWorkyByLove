#!/usr/bin/env node
/**
 * 0lz: deploy/FE/security hardening + operator waiting exclude.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const feIdx = read('frontend/index.html');
const guard = read('backend/scripts/_deploy_guard.sh');
const opsQ = read('backend/services/opsQuality.js');
const sil = read('backend/services/silenceCatchup.js');
const ai = read('backend/services/aiResponder.js');
const server = read('backend/server.js');
const getUserId = read('backend/lib/getUserId.js');
const full = read('backend/scripts/_hard_audit_full_0ht.js');

check('fe not OPS subtitle', !/операторская,\s*вне Telegram/.test(feIdx));
check('fe has app-splash', /id="app-splash"|app-splash/.test(feIdx));
check('fe styles.css', /styles\.css\?v=\d+/.test(feIdx));
check('guard refuse OPS', /REFUSE_FRONTEND_IS_OPS/.test(guard) && /app-splash/.test(guard));
check('guard refuse fake openai', /REFUSE_OPENAI_FAKE_KEY/.test(guard));
check('waiting excludes operator stage', /NOT IN \('filtered','operator'\)/.test(opsQ));
check('silence excludes operator stage', /NOT IN \('filtered','operator'\)/.test(sil));
check('waiting night/work gate', /isNightTextQuietHour/.test(opsQ) && /isWithinGlobalWorkingHours/.test(opsQ));
check('conn error transport', /Connection error/.test(ai) && /APIConnectionError/.test(ai));
check('dead proxy TTL 12m', /12\s*\*\s*60\s*\*\s*1000/.test(ai));
check('cors not wildcard origin', !/origin:\s*true/.test(server) && !/origin:\s*['"]\*['"]/.test(server));
check('getUserId no return 1', !/\breturn\s+1\b/.test(getUserId));
check('getUserId 401', /401/.test(getUserId));
check('full audit timeout ≥180s', /180_000/.test(full));
check('full audit includes 0lz smoke', /_smoke_project_harden_0lz/.test(full));
check('full audit marker-first', /Marker first|okMarker\.test\(out\)/.test(full));
const ht = read('backend/scripts/_hard_audit_0ht.js');
check('hard 0ht process.exit(0)', /HARD_AUDIT_0HT_OK[\s\S]{0,40}process\.exit\(0\)/.test(ht));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_PROJECT_HARDEN_0LZ_OK');
process.exit(0);
