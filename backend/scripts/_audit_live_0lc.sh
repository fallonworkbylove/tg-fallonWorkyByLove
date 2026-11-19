#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
echo ---WIRE---
grep -n 'nav-indicator\|syncNavIndicator\|is-ready\|styles.css?v=105\|app.js?v=184\|updates.js?v=234' \
  "$BASE/frontend/index.html" "$BASE/frontend/app.js" | head -40
grep -q 'Анимации по всему приложению' "$BASE/frontend/updates.js"
grep -q '## 0lc\.' "$BASE/CHANGELOG_TG.md"
echo ---PROXY---
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
e=[x for x in json.load(open('/tmp/pm2j.json')) if x['name']=='tgbot'][0]['pm2_env']
n=len([x for x in (e.get('PROXY_LIST') or '').split(';') if x.strip()])
print({'status': e['status'], 'PROXY': n})
assert e['status']=='online' and n>=5
PY
echo AUDIT_LIVE_0lc_OK
