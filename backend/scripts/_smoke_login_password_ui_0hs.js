/**
 * Smoke 0hs: password field only on needPassword step; resolvePasswordNeeded wired.
 */
const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('OK', msg);
  }
};

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../frontend/app.js'), 'utf8');
assert(/showPassword\s*=\s*step\s*===\s*'password'/.test(app), 'UI password only on password step');
assert(!/showPassword\s*=\s*method\s*===\s*'code'\s*\|\|/.test(app), 'UI no longer always-show on code');
assert(/Двухэтапная проверка/.test(app), 'hint mentions two-step settings');

const login = fs.readFileSync(path.join(__dirname, '../services/loginAuth.js'), 'utf8');
assert(/async function resolvePasswordNeeded/.test(login), 'resolvePasswordNeeded exists');
assert(/has_password|hasPassword/.test(login), 'probes has_password');
assert(/PASSWORD_FALSE_POSITIVE/.test(login), 'false-positive code');
assert(/return resolvePasswordNeeded\(key, entry/.test(login), 'confirmCode/QR use resolve');

const wc = fs.readFileSync(path.join(__dirname, '../services/workerConnect.js'), 'utf8');
assert(/Двухэтапная проверка/.test(wc), 'worker bot hint clear');
assert(/\/cancel/.test(wc), 'worker suggests cancel retry');

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_LOGIN_PASSWORD_UI_0HS_OK');
process.exit(process.exitCode || 0);
