#!/bin/bash
# Restore AI stack after Oct 13-14 day test.
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cd "$ROOT"
SVC=backend/services
BAK=$(readlink -f "$SVC/_bak_daytest_CURRENT" 2>/dev/null || true)
if [[ -z "${BAK:-}" || ! -f "$BAK/aiResponder.js" ]]; then
  BAK=$(ls -dt "$SVC"/_bak_daytest_* 2>/dev/null | head -1 || true)
fi
if [[ -z "${BAK:-}" || ! -f "$BAK/aiResponder.js" ]]; then
  echo "No daytest backup found"; exit 1
fi
echo "Restoring from $BAK"
cp -a "$BAK/aiResponder.js" "$SVC/aiResponder.js"
[[ -f "$BAK/humanizeSpeech.js" ]] && cp -a "$BAK/humanizeSpeech.js" "$SVC/humanizeSpeech.js"
[[ -f "$BAK/lifeTexture.js" ]] && cp -a "$BAK/lifeTexture.js" "$SVC/lifeTexture.js"
[[ -f "$BAK/objectionHandler.js" ]] && cp -a "$BAK/objectionHandler.js" "$SVC/objectionHandler.js"
node --check "$SVC/aiResponder.js"
pm2 restart tgbot --update-env
echo "Restored Oct-12 humanity stack from $BAK"
