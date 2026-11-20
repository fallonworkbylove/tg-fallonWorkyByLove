/** Smoke 0m6 — логи overflow + CSV modal copy. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
function assert(c, m) {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
}
assert(/\.admin-log-console\s*\{/.test(css), 'log console css');
assert(/overflow-wrap:\s*anywhere/.test(css) || /word-break:\s*break-word/.test(css), 'wrap');
assert(/openCsvExportModal|copy-csv|copyTextSafe/.test(app), 'csv modal');
assert(/notify\('CSV готов/.test(app), 'honest notify');
assert(!/notify\('CSV скачан'\)/.test(app), 'no fake downloaded');
assert(/updates\.js\?v=263/.test(html) && /styles\.css\?v=113/.test(html) && /app\.js\?v=188/.test(html), 'bumps');
console.log('SMOKE_LOGS_CSV_0M6_OK');
process.exit(0);
