#!/bin/bash
# Log tick every ~3m for AI10 watch
BASE=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$BASE" || exit 1
echo "===== WATCH $(date -u +%H:%M:%SZ) ====="
pm2 jlist 2>/dev/null | python3 -c "import json,sys; j=json.load(sys.stdin); p=[x for x in j if x['name']=='tgbot'][0]; e=p['pm2_env']; print('pm2',e['status'],'PROXY',len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()]),'uptime',e.get('pm_uptime'))" 2>/dev/null || true
AUDIT_FIX_SINCE='2026-11-04 19:50:00' node scripts/_ai10_gaps_now.js 2>/dev/null | head -40
echo '--- recent replies ---'
pm2 logs tgbot --lines 80 --nostream 2>&1 | grep -aE 'Ответ для|silence-heal|silenceCatchup|ага\)|REFUSE_PROXY|OPENAI|Not connected|Занята' | tail -25
echo '--- score ---'
AUDIT_FIX_SINCE='2026-11-04 19:50:00' node scripts/_audit_10of10_score.js 2>/dev/null | tail -25
