#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0il}
cp -a "$SRC/styles.css" "$BASE/frontend/styles.css"
cp -a "$SRC/updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
grep -q 'minmax(0, 1fr)' "$BASE/frontend/styles.css"
grep -q 'Анкета больше не уезжает' "$BASE/frontend/updates.js"
grep -q 'Анкета больше не уезжает' "$BASE/ops-console/app/updates.js"
grep -q 'styles.css?v=74' "$BASE/frontend/index.html"
grep -q 'updates.js?v=166' "$BASE/frontend/index.html"
echo DONE_0il
grep -oE 'styles.css\?v=[0-9]+|updates.js\?v=[0-9]+' "$BASE/frontend/index.html"
