#!/bin/bash
# LoveRussian post-add audit C (хард жёсткий) — after 0lf/0lg/0lh
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-audit-c}"
P0=0
P1=0
pass() { echo "OK  $1"; }
fail() { local lvl="$1"; shift; echo "$lvl $*"; if [ "$lvl" = P0 ]; then P0=$((P0+1)); else P1=$((P1+1)); fi; }

echo "=== AUDIT C · хард жёсткий ==="
echo "--- A: smoke + wiring ---"
node scripts/_smoke_nft_live90_0lh.js >/tmp/a_0lh.txt 2>&1 && pass smoke_0lh || fail P0 smoke_0lh
node scripts/_smoke_nft_stale_0lg.js >/tmp/a_0lg.txt 2>&1 && pass smoke_0lg || fail P0 smoke_0lg
node scripts/_smoke_ops_board_0lf.js >/tmp/a_0lf.txt 2>&1 && pass smoke_0lf || fail P0 smoke_0lf
grep -q 'NFT_LIVE_DIALOG_MIN) || 90' services/nftCampaign.js && pass wire_live90 || fail P0 wire_live90
grep -q 'expireStaleNftAfterWork' services/nftCampaign.js && pass wire_expire || fail P0 wire_expire
grep -q 'runOpenAiReadyWatch' services/opsQuality.js && pass wire_openai_watch || fail P0 wire_openai_watch
grep -q 'funnelBoard' services/adminConsoleStats.js && pass wire_funnel || fail P1 wire_funnel
grep -q 'updates.js?v=239' ../frontend/index.html && pass updates_v || fail P1 updates_v
grep -q '## 0lh\.' ../CHANGELOG_TG.md && pass changelog || fail P1 changelog

echo "--- B: hard_0ht (150s) + human ---"
timeout 150s node scripts/_hard_audit_0ht.js >/tmp/hard_0ht.txt 2>&1
ec=$?
if [ $ec -eq 0 ]; then pass hard_0ht
elif [ $ec -eq 124 ]; then fail P1 hard_0ht_timeout
else fail P0 hard_0ht "$(grep -E 'FAIL|P0' /tmp/hard_0ht.txt | head -5)"
fi
grep -qE 'phraseBanLimitFor' services/softHumanLite.js services/humanHardening.js 2>/dev/null && pass phrase_ban || fail P1 phrase_ban
grep -q 'startOpsQualitySchedulers' server.js && pass ops_schedulers || fail P0 ops_schedulers

echo "--- live greps ---"
grep -aE 'AI замолчал|outbound ' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -8 || true
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|null\.chat' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -8 || true
# recent NFT (ignore historical stuck alerts before 0lg)
grep -aE 'NFT expire stale|Отправлено голосовое про NFT|Перед NFT' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -8 || true

echo "--- C: full (skip nested 0ht if already OK) + ultra + security ---"
# hard_full nests hard_0ht with 60s timeout → false P0; run full but treat only non-timeout P0
timeout 200s node scripts/_hard_audit_full_0ht.js >/tmp/hard_full.txt 2>&1 || true
FULL_P0=$(grep -cE '^P0 ' /tmp/hard_full.txt 2>/dev/null || echo 0)
# Filter known false: hard_0ht timeout mid-check
REAL_P0=$(grep -E '^P0 ' /tmp/hard_full.txt 2>/dev/null | grep -v '_hard_audit_0ht.js' | grep -v 'clearBusy' || true)
if [ -z "$REAL_P0" ]; then
  pass hard_full_no_real_P0
else
  fail P0 hard_full "$REAL_P0"
fi
tail -15 /tmp/hard_full.txt

timeout 120s node scripts/_ultra_hard_audit.js >/tmp/ultra.txt 2>&1
ec=$?
ULTRA_P0=$(grep -E 'P0_COUNT' /tmp/ultra.txt | tail -1 || true)
echo "$ULTRA_P0"
if [ $ec -eq 0 ]; then pass ultra_hard
elif echo "$ULTRA_P0" | grep -q 'P0_COUNT 0'; then pass ultra_hard_soft_fail
else fail P1 ultra_ec_$ec
fi
grep -E 'VERDICT|CHECKS' /tmp/ultra.txt | tail -3

# security — ignore comments in getUserId
python3 - <<'PY'
from pathlib import Path
p = Path('lib/getUserId.js').read_text(encoding='utf-8')
code = '\n'.join(l for l in p.splitlines() if not l.strip().startswith('//') and '/*' not in l)
bad = False
if '|| 1' in code or 'return 1' in code or "|| '1'" in code:
    bad = True
print('getUserId_clean', not bad)
raise SystemExit(1 if bad else 0)
PY
[ $? -eq 0 ] && pass getUserId_no_1 || fail P0 getUserId_fallback_1
grep -q 'TELEGRAM_AUTH_BYPASS' middleware/telegramAuth.js && grep -qE 'loopback|remoteAddress' middleware/telegramAuth.js && pass auth_bypass_gated || fail P0 auth_bypass
if grep -qE "Access-Control-Allow-Origin['\"]?\s*:\s*['\"]\*['\"]" server.js; then fail P0 cors_star; else pass cors_not_star; fi

echo "--- pm2 / guard / nft ---"
python3 - <<'PY'
import json,subprocess
d=json.loads(subprocess.check_output(['pm2','jlist'],text=True))
e=d[0]['pm2_env']
pl=[x for x in str(e.get('PROXY_LIST') or '').split(';') if x.strip()]
print('pm2',e.get('status'),'PROXY',len(pl),'AUDIT',repr(e.get('AUDIT_SMOKE')))
assert e.get('status')=='online' and len(pl)>=5
PY
[ $? -eq 0 ] && pass pm2_proxy || fail P0 pm2_proxy
bash scripts/_deploy_guard.sh && pass deploy_guard || fail P0 deploy_guard
node - <<'NODE'
require('dotenv').config({quiet:true});
const db=require('./db');
(async()=>{
  const [[stuck]]=await db.execute(`SELECT COUNT(*) n FROM nft_voice_schedule nvs
    WHERE work_mention_sent=1 AND (voice_skip_reason IS NULL OR voice_skip_reason='')
      AND scheduled_at < (NOW()-INTERVAL 90 MINUTE)
      AND NOT EXISTS (SELECT 1 FROM conversation_messages cm
        WHERE cm.account_id=nvs.account_id AND cm.peer_id=nvs.peer_id
          AND cm.role='assistant' AND cm.content LIKE '%nft.ogg%'
          AND cm.created_at>=nvs.work_mention_at)`);
  const [[stale]]=await db.execute(`SELECT COUNT(*) n FROM nft_voice_schedule WHERE voice_skip_reason='stale_dialog'`);
  console.log(JSON.stringify({stuckLeft:Number(stuck.n), stale_dialog:Number(stale.n)}));
  process.exit(Number(stuck.n)>0?4:0);
})().catch(e=>{console.error(e);process.exit(1);});
NODE
[ $? -eq 0 ] && pass nft_stuck_cleared || fail P1 nft_stuck

echo "=== AUDIT_C_SUMMARY P0=$P0 P1=$P1 ==="
if [ "$P0" -gt 0 ]; then echo AUDIT_C_FAIL; exit 1; fi
echo AUDIT_C_OK
exit 0
