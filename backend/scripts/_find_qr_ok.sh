#!/bin/bash
OUT=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log
echo "=== QR SUCCESS-ISH ==="
grep -aEi 'QR старт|qr ok|QR OK|session saved|ExportLoginToken|login success|успеш|signed in|authorized|qr.*token|через socks5.*tg://login' "$OUT" "$ERR" 2>/dev/null | tail -40
echo "=== RECENT LOGIN OUT ==="
grep -aE '\[login\]' "$OUT" | tail -50
echo "=== RECENT LOGIN ERR ==="
grep -aE '\[login\]' "$ERR" | tail -40
echo "=== NEW ACCOUNTS / SESSIONS ==="
grep -aEi 'account.*login|new session|сохранил|sessionString|аккаунт.*(добав|создан|online)|user=[0-9]+' "$OUT" | tail -30
echo DONE
