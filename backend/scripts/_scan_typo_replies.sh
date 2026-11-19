#!/bin/bash
# #42 last ~50 replies with typo-ish patterns from tgbot-out
set -euo pipefail
LOG=${1:-/root/.pm2/logs/tgbot-out.log}
grep -aE 'Ответ для ' "$LOG" | tail -n 200 | grep -aE 'пр альное|поимер|кааец|всегва|тогва|бывпет|разбрров|предаочтен|прикрльно|жнсть|поосто|дрстанут|саокойн|Радуже|ться,|,\s*$' | tail -n 50 || true
echo TYPO_SCAN_DONE
