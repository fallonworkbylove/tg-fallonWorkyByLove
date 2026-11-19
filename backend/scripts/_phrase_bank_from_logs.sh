#!/bin/bash
# #44 weekly: top cliché candidates from out.log
set -euo pipefail
LOG=${1:-/root/.pm2/logs/tgbot-out.log}
echo "=== phrase candidates $(date -u +%F) ==="
for p in 'просто общаюсь' 'не покажу' 'я обычная' 'как тебе' 'кайф' 'ну ок' 'ага)'; do
  n=$(grep -acF "$p" "$LOG" 2>/dev/null || echo 0)
  echo "$n	$p"
done | sort -rn | head -20
echo PHRASE_BANK_SCAN_DONE
