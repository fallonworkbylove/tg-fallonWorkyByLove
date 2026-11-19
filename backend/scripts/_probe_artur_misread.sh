#!/bin/bash
set -euo pipefail
PEER=suport_service_v
echo "=== lines around 'первый день' / флипинг repeat ==="
grep -aF "$PEER" /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-out__2026-10-31_00-00-00.log 2>/dev/null | grep -aE 'первый день|флипинг|флип|NFT|что такое|hint|Ответ|voice' | tail -80
