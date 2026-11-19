'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const svc = fs.readFileSync(path.join(root, 'backend', 'services', 'opsActivityLog.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const updates = fs.readFileSync(path.join(root, 'frontend', 'updates.js'), 'utf8');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

check('svc_is_smoke', /function isSmokeEvent/.test(svc));
check('svc_purge', /function purgeSmokeActivity/.test(svc));
check('svc_without_smoke', /withoutSmoke\(/.test(svc));
check('app_filter', /isSmokeActivityItem/.test(app) && /activityDisplayTitle/.test(app));
check('html_v95', /styles\.css\?v=95/.test(html));
check('html_app_v181', /app\.js\?v=181/.test(html));
check('html_updates_v221', /updates\.js\?v=221/.test(html));
check('css_pad', /\.activity-item \{[\s\S]*?padding:\s*18px 18px 18px 20px/.test(css));
check('updates_title', /Убрали тестовые записи из ленты/.test(updates));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK purge_smoke_0kp');
process.exit(0);
