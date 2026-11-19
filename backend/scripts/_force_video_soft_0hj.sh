#!/bin/bash
set -uo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

echo "===== soft now ====="
node <<'NODE'
require('dotenv').config();
const { findUnfulfilledMediaGaps, findDbSilenceGaps } = require('./services/silenceCatchup');
(async () => {
  const soft = await findUnfulfilledMediaGaps({ maxAgeHours: 12, limit: 10 });
  const gaps = await findDbSilenceGaps({ maxAgeHours: 12, minAgeMin: 1, limit: 15 });
  console.log('soft', soft.length, soft);
  console.log('gaps', gaps.length, gaps.filter(g => String(g.peer_id)==='6868829215' || /лайф|видео/i.test(String(g.last_user_text||''))));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
NODE

echo "===== recent vika crocodile ====="
grep -aE '🐊|6868829215|видео записать лайф|silence-heal' /root/.pm2/logs/tgbot-out.log | tail -40

echo "===== wait one heal tick 320s ====="
sleep 320

echo "===== after wait ====="
node scripts/_check_video_life_0hj.js
node <<'NODE'
require('dotenv').config();
const { findUnfulfilledMediaGaps } = require('./services/silenceCatchup');
(async () => {
  const soft = await findUnfulfilledMediaGaps({ maxAgeHours: 12, limit: 10 });
  console.log('soft_after', soft.length, soft.map(r=>({a:r.account_id,p:r.peer_id,u:r.last_user_text,b:r.last_bot_text})));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
NODE
grep -aE '🐊|лайф|silenceCatchup healed' /root/.pm2/logs/tgbot-out.log | tail -20
echo FORCE_VIDEO_DONE
