#!/bin/bash
set -uo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "wait 110s for silence+heal..."
sleep 110

echo "===== soft/hard gaps ====="
node <<'NODE'
require('dotenv').config();
const { findUnfulfilledMediaGaps, findDbSilenceGaps } = require('./services/silenceCatchup');
(async () => {
  const soft = await findUnfulfilledMediaGaps({ maxAgeHours: 12, limit: 10 });
  const gaps = await findDbSilenceGaps({ maxAgeHours: 12, minAgeMin: 3, limit: 10 });
  console.log('soft_media', soft.length, JSON.stringify(soft.map(r => ({a:r.account_id,p:r.peer_id,u:String(r.last_user_text||'').slice(0,60),b:String(r.last_bot_text||'').slice(0,60)})),null,2));
  console.log('hard_gaps', gaps.length, JSON.stringify(gaps.map(r => ({a:r.account_id,p:r.peer_id,u:String(r.last_user_text||'').slice(0,60)})),null,2));
  const video = soft.find(r => String(r.peer_id)==='6868829215' || /лайф/i.test(String(r.last_user_text||'')));
  console.log('video_life_soft_still', Boolean(video));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
NODE

echo "===== heal logs after hotfix ====="
grep -aE 'silence-heal|silenceCatchup|mediaSoft' /root/.pm2/logs/tgbot-out.log | tail -25
grep -aE 'silence-heal|silenceCatchup' /root/.pm2/logs/tgbot-error.log | tail -15

echo "===== Warm ====="
grep -a 'Warm TG:' /root/.pm2/logs/tgbot-out.log | tail -5

echo "===== nightly ====="
timeout 60 env OPENAI_API_KEY=sk-test node scripts/_nightly_hard_audit.js 2>&1 | tail -12 || echo NIGHTLY_TIMEOUT

echo "===== mega lite ====="
bash /tmp/_mega_hard_audit_0hj.sh 2>&1 | tee /tmp/audit_0hj_post.txt | tail -80

echo VERIFY_0HJ_DONE
