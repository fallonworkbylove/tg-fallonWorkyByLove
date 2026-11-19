#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -a /tmp/sac/operatorAccess.js "$BASE/backend/services/operatorAccess.js"
cp -a /tmp/sac/opsAdmin.js "$BASE/backend/services/opsAdmin.js"
cp -a /tmp/sac/updates.js "$BASE/frontend/updates.js"
cp -a /tmp/sac/index.html "$BASE/frontend/index.html"
cd "$BASE/backend"
node -e "
require('dotenv').config();
const oa=require('./services/operatorAccess');
(async()=>{
  const a=await oa.isAdmin(8588744561,'fallonsociapat');
  const b=await oa.isAdmin(null,'fallonsociapat');
  const c=await oa.isAdmin(1,'maximdolbin');
  console.log({a,b,byNameOnly:b,maxim:c,super:oa.SUPER_ADMIN_ID});
  if(!a||!b) process.exit(2);
})().catch(e=>{console.error(e);process.exit(1);});
"
pm2 restart tgbot --update-env
echo DEPLOY_SUPERADMIN_OK
