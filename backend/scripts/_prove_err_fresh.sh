#!/bin/bash
set -euo pipefail
echo "=== ERR file mtime / size ==="
ls -la /root/.pm2/logs/tgbot-error.log
echo
echo "=== ERR last 80 ==="
tail -80 /root/.pm2/logs/tgbot-error.log
echo
echo "=== isContradictory in last 5000 OUT ==="
tail -5000 /root/.pm2/logs/tgbot-out.log | grep -c 'isContradictory' || true
tail -5000 /root/.pm2/logs/tgbot-out.log | grep 'isContradictory' | tail -5 || true
echo
echo "=== VPS replyPipeline mediaHelpers ==="
grep -n 'mediaHelpers\|isContradictoryMediaText' /root/opt/tgbot/tg-miniapp-loverussian/backend/services/replyPipeline.js | head -20
echo
MARK='AUDIT_FRESH_MARK_20261027170831'
echo "=== OUT after mark (tail) ==="
awk -v m="$MARK" 'found{print} $0~m{found=1}' /root/.pm2/logs/tgbot-out.log | tail -100
echo
echo "=== ERROR/Ошибка after mark in OUT ==="
awk -v m="$MARK" 'found{print} $0~m{found=1}' /root/.pm2/logs/tgbot-out.log | grep -E 'Ошибка|isContradictory|ECONNREFUSED|Error' || echo '(none)'
echo
echo "=== truncate ERR and watch 90s for NEW writes ==="
cp /root/.pm2/logs/tgbot-error.log /tmp/tgbot-error.bak.$(date +%s)
: > /root/.pm2/logs/tgbot-error.log
echo "[ERR_WATCH_START $(date -u +%Y-%m-%dT%H:%M:%SZ)]" >> /root/.pm2/logs/tgbot-error.log
sleep 90
echo "=== ERR after 90s watch ==="
cat /root/.pm2/logs/tgbot-error.log
echo "=== OUT last 25 during watch ==="
pm2 logs tgbot --out --lines 25 --nostream 2>/dev/null | tail -25
echo DONE
