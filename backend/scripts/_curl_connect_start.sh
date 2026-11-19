#!/bin/bash
set -euo pipefail
PHONE="${1:-+79244855206}"
# AUTH bypass uses X headers when TELEGRAM_AUTH_BYPASS=true — check middleware
curl -sS -X POST 'http://127.0.0.1:3000/api/accounts/connect/start' \
  -H 'Content-Type: application/json' \
  -H 'X-Telegram-User-Id: 8588744561' \
  -d "{\"phone\":\"${PHONE}\"}"
echo
