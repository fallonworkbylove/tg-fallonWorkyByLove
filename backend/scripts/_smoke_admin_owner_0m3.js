/**
 * Smoke 0m3 — админ: разные панели + клик по владельцу пула.
 */
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

const root = path.join(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');

assert(/adminOwnerKey|openAdminOwnerPool|admin-owner-open/.test(app), 'owner helpers');
assert(/setAdminOwnerFilter|clearAdminOwnerFilter|ownerFilter/.test(app), 'owner filter');
assert(/admin-acc__owner/.test(app) && /admin-acc__owner/.test(css), 'owner clickable');
assert(/admin-block\[hidden\]/.test(css), 'hidden panels css');
assert(/admin-panel--activity/.test(html) && /admin-panel--radar/.test(html), 'panel classes');
assert(/admin-panel--ideas/.test(html), 'ideas class');
assert(/Лента · не радар/.test(html) && /Сводка · не события/.test(html), 'panel kickers');
assert(/Только создатель · не радар/.test(html), 'ideas kicker');
assert(/admin-owner-filter/.test(html), 'filter bar markup');
assert(/updates\.js\?v=260/.test(html), 'updates bump');
assert(/app\.js\?v=187/.test(html), 'app bump');
assert(/styles\.css\?v=110/.test(html), 'css bump');
assert(/data-admin-panel="activity"/.test(html), 'activity panel');
assert(/data-admin-panel="radar"/.test(html), 'radar panel');
assert(/data-admin-panel="ideas"/.test(html), 'ideas panel');

console.log('SMOKE_ADMIN_OWNER_0M3_OK');
process.exit(0);
