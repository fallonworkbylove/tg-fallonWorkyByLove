#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
tar -xf /tmp/p0fix.tar -C "$BASE"
grep -q "status === 'needPassword'" "$BASE/backend/services/adminOps.js" && echo needPassword_ok
grep -q releaseLoginHandoff "$BASE/backend/services/loginAuth.js" && echo handoff_ok
grep -q markFreshSession "$BASE/backend/services/clientPool.js" && echo grace_ok
grep -q abortIfPausedOrBlacklisted "$BASE/backend/services/replyPipeline.js" && echo pause_ok
grep -q alreadyAuthorized "$BASE/backend/routes/accounts.js" && echo accounts_ok
grep -q "Fail-closed" "$BASE/backend/services/peers.js" && echo peers_ok
grep -q "nft_voice_sent" "$BASE/backend/services/helpRequestNotifier.js" && echo nft_ok
grep -q "7200" "$BASE/backend/middleware/telegramAuth.js" && echo initdata_ok
pm2 restart tgbot --update-env
echo DEPLOY_OK
