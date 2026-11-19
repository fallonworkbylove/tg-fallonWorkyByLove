#!/bin/bash
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend"
echo "=== post-audit 0lg B ==="
grep -q 'Не зависает после' "$BASE/frontend/updates.js" && echo UPDATES_OK
grep -q 'updates.js?v=238' "$BASE/frontend/index.html" && echo INDEX_OK
python3 -c 'import json,subprocess;d=json.loads(subprocess.check_output(["pm2","jlist"],text=True));e=d[0]["pm2_env"];pl=[x for x in str(e.get("PROXY_LIST") or "").split(";") if x.strip()];print("pm2",e.get("status"),"PROXY",len(pl))'
grep -q expireStaleNftAfterWork services/nftCampaign.js && echo WIRE_expire
grep -q stale_dialog services/nftCampaign.js && echo WIRE_reason
node scripts/_smoke_nft_stale_0lg.js
node -e "require('dotenv').config({quiet:true});const db=require('./db');(async()=>{const [[s]]=await db.execute(\"SELECT COUNT(*) n FROM nft_voice_schedule WHERE work_mention_sent=1 AND (voice_skip_reason IS NULL OR voice_skip_reason='') AND scheduled_at<(NOW()-INTERVAL 90 MINUTE) AND NOT EXISTS (SELECT 1 FROM conversation_messages cm WHERE cm.account_id=nft_voice_schedule.account_id AND cm.peer_id=nft_voice_schedule.peer_id AND cm.role='assistant' AND (cm.content LIKE '%nft.ogg%') AND cm.created_at>=work_mention_at)\");const [[sk]]=await db.execute(\"SELECT COUNT(*) n FROM nft_voice_schedule WHERE voice_skip_reason='stale_dialog'\");console.log('stuckLeft',s.n,'stale_dialog',sk.n);process.exit(0);})().catch(e=>{console.error(e);process.exit(1);})"
bash scripts/_deploy_guard.sh
echo POST_AUDIT_0lg_DONE
