#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian

echo "=== 1) deploy AI humanize ==="
cp /tmp/softHumanLite.js /tmp/humanThinLayer.js "$B/backend/services/"
grep -n 'humanizeChatTexture\|сбивчиво' "$B/backend/services/softHumanLite.js" "$B/backend/services/humanThinLayer.js" | head -6

cd "$B/backend"
node -e "
require('dotenv').config({quiet:true});
const s=require('./services/softHumanLite');
const t=s.humanizeChatTexture('Безусловно, я хотела бы продолжить общение');
if(/безусловно|хотела бы|продолжить общение/i.test(t)) { console.error('fail texture', t); process.exit(1); }
const a=s.ensureAckNotBare('ага)');
if(/^(?:ага|угу|ну да|хм ок)\)?$/i.test(a)) { console.error('fail ack', a); process.exit(1); }
const t2=s.humanizeChatTexture('Безусловно, я хотела бы продолжить общение');
if(/безусловно|хотела бы|продолжить общение/i.test(t2)) { console.error('fail texture2', t2); process.exit(1); }
console.log('human_ok', t2, '|', a);
"

timeout 40 pm2 restart tgbot --update-env
sleep 40
pm2 status tgbot | head -5

SINCE=$(date -u +'%Y-%m-%d %H:%M:%S' -d '5 minutes ago')
echo "=== AUDIT 1 (after AI) since=$SINCE ==="
AUDIT_FIX_SINCE='2026-10-27 15:52:00' node scripts/_ultra_hard_audit.js | tee /tmp/aud1.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|findings.: \['
echo "=== AUDIT 2 (after AI) ==="
AUDIT_FIX_SINCE='2026-10-27 15:52:00' node scripts/_ultra_hard_audit.js | tee /tmp/aud2.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|findings.: \['

echo "=== 2) deploy pink-purple UI ==="
cp /tmp/styles.css /tmp/index.html /tmp/updates.js /tmp/app.js "$B/frontend/"
grep -n 'e879c8\|Живее и розовее\|styles.css?v=58\|app.js?v=58' \
  "$B/frontend/styles.css" "$B/frontend/updates.js" "$B/frontend/index.html" | head -10

# frontend static — no pm2 needed, but bump ok
sleep 2

echo "=== AUDIT 3 (after visual) ==="
# extend ultra to require pink primary + new updates title when files present
node <<'NODE'
const fs = require('fs');
const path = require('path');
const root = '/root/opt/tgbot/tg-miniapp-loverussian';
const styles = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');
const updates = fs.readFileSync(path.join(root, 'frontend/updates.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
let fail = 0;
function ok(n, c) { if (!c) { console.error('FAIL', n); fail++; } else console.log('ok', n); }
ok('pink_primary', /--primary:\s*#e879c8/i.test(styles));
ok('purple_strong', /--primary-strong:\s*#c026d3/i.test(styles));
ok('updates_pink_post', /Живее и розовее/.test(updates));
ok('cache_v58', /styles\.css\?v=58/.test(index) && /app\.js\?v=58/.test(index));
ok('humanize_on_disk', /humanizeChatTexture/.test(fs.readFileSync(path.join(root,'backend/services/softHumanLite.js'),'utf8')));
if (fail) process.exit(1);
console.log('visual_checks_ok');
NODE

AUDIT_FIX_SINCE='2026-10-27 15:52:00' node scripts/_ultra_hard_audit.js | tee /tmp/aud3.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|findings.: \['

# summary
node <<'NODE'
const fs=require('fs');
function parse(p){
  const t=fs.readFileSync(p,'utf8');
  const i=t.indexOf('{'); const j=t.lastIndexOf('}');
  return JSON.parse(t.slice(i,j+1));
}
const a=parse('/tmp/aud1.txt'), b=parse('/tmp/aud2.txt'), c=parse('/tmp/aud3.txt');
console.log(JSON.stringify({
  audit1: { overall:a.overall, checks:a.checks, findings:a.findings.length, score:a.score },
  audit2: { overall:b.overall, checks:b.checks, findings:b.findings.length, score:b.score },
  audit3: { overall:c.overall, checks:c.checks, findings:c.findings.length, score:c.score },
}, null, 2));
NODE
echo HUMAN_STYLE_AUDITS_DONE
