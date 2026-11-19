#!/bin/bash
set -euo pipefail
echo '=== node/gram processes ==='
ps aux | grep -E 'node|telegram|tgbot' | grep -v grep | head -40
echo '=== out last 80 ==='
tail -n 80 /root/.pm2/logs/tgbot-out.log
echo '=== err last 40 ==='
tail -n 40 /root/.pm2/logs/tgbot-error.log
