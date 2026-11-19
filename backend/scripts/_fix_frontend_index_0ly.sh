#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0ly}

# Restore worker miniapp index (was overwritten by OPS html during scp name clash)
cp -f "$SRC/index_frontend.html" "$BASE/frontend/index.html"
cp -f "$SRC/updates_fe.js" "$BASE/frontend/updates.js"
# Keep ops correct too
cp -f "$SRC/index_ops.html" "$BASE/ops-console/app/index.html"
cp -f "$SRC/updates_ops.js" "$BASE/ops-console/app/updates.js"
cp -f "$SRC/CHANGELOG_TG.md" "$BASE/CHANGELOG_TG.md"

# Gate: frontend must NOT be OPS console
if grep -q 'операторская, вне Telegram' "$BASE/frontend/index.html"; then
  echo REFUSE_FRONTEND_IS_OPS
  exit 1
fi
if ! grep -q 'app-splash' "$BASE/frontend/index.html"; then
  echo REFUSE_FRONTEND_NOT_MINIAPP
  exit 1
fi
if ! grep -q 'LoveRussian OPS' "$BASE/ops-console/app/index.html"; then
  echo REFUSE_OPS_INDEX_WRONG
  exit 1
fi
grep -q 'updates.js?v=254' "$BASE/frontend/index.html" || grep -q 'updates.js?v=255' "$BASE/frontend/index.html"

echo "frontend_title=$(grep -o '<title>[^<]*' "$BASE/frontend/index.html" | head -1)"
echo "ops_title=$(grep -o '<title>[^<]*' "$BASE/ops-console/app/index.html" | head -1)"
echo FIX_FRONTEND_INDEX_0LY_OK
