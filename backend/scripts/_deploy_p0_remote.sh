#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
tar -xf /tmp/p0fix.tar -C "$BASE"
cd "$BASE/backend"
node -e "require('./services/loginAuth'); require('./services/adminOps'); require('./services/operatorAccess'); require('./middleware/telegramAuth'); require('./services/clientPool'); require('./services/replyPipeline'); console.log('require_ok')"
# smoke without ops-console path
node -e "
const fs=require('fs');
const a=require('./services/operatorAccess');
if (a.isSuperAdmin(null,'fallonsociapat')) throw new Error('username superadmin');
const s=fs.readFileSync('./services/adminOps.js','utf8');
if (!/result\\?\\.status === 'needPassword'/.test(s)) throw new Error('needPassword');
console.log('smoke_ok');
"
pm2 restart tgbot --update-env
echo DEPLOY_OK
