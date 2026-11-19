#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/ladno
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/"
cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/"
cp -a "$SRC/updates.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cd "$BASE/backend"
node -e 'const s=require("./services/softHumanLite"); const o=s.fixAwkwardLadnoPredicate("о, малыш) молодость - это ладно"); if(/это\s+ладно/i.test(o)) { console.error(o); process.exit(1);} console.log("ladno_ok", o);'
pm2 restart tgbot --update-env
echo DONE
