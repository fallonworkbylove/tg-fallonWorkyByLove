#!/bin/bash
set -euo pipefail
sleep 2
pm2 logs tgbot --err --lines 25 --nostream 2>/dev/null | grep -vE 'telegramAuth|injected' | tail -12 || true
pm2 logs tgbot --out --lines 50 --nostream 2>/dev/null | grep -E '7173|id=21|активирован|Error|ReferenceError|is not defined|Cannot' | tail -25 || true
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node scripts/_smoke_audit10.js 2>/dev/null | tail -22
