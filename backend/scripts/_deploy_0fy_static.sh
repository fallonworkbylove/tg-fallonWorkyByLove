#!/bin/bash
# Static + audit scripts only — NO pm2 restart (AI stays up).
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/0fy
cp -a "$SRC/updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/CHANGELOG_TG.md"
cp -a "$SRC/_hard_audit_0fx.js" "$BASE/backend/scripts/"
cp -a "$SRC/_live_watch_15m.sh" /tmp/_live_watch_15m.sh
chmod +x /tmp/_live_watch_15m.sh
if [ -d "$BASE/ops-console/app" ]; then
  cp -a "$SRC/updates.js" "$BASE/ops-console/app/updates.js"
fi
echo '=== HARD AUDIT (no restart) ==='
cd "$BASE/backend"
# Use running process env? Audit only needs files + dummy key
OPENAI_API_KEY="${OPENAI_API_KEY:-sk-smoke-hard}" node scripts/_hard_audit_0fx.js 2>/dev/null | tail -40

echo '=== tgbot still online? ==='
pm2 jlist | python3 -c 'import sys,json; p=[x for x in json.load(sys.stdin) if x.get("name")=="tgbot"][0]; print(p["pm2_env"]["status"], "restarts", p["pm2_env"]["restart_time"])'

echo '=== start live 15m in background ==='
nohup bash /tmp/_live_watch_15m.sh >/tmp/live_watch_15m_run.log 2>&1 &
echo "live_pid=$!"
echo DEPLOY_0FY_STATIC_OK
