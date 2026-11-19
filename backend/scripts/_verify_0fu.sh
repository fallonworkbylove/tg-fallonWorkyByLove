#!/bin/bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
err=Path('/root/.pm2/logs/tgbot-error.log').read_text(encoding='utf-8',errors='replace').splitlines()
idxs=[i for i,l in enumerate(err) if 'setMyCommands' in l]
print('setMyCommands count', len(idxs), 'last_idx', idxs[-1] if idxs else None)
if idxs:
    tail=err[idxs[-1]:]
    print('lines_after_last_setMyCommands', len(tail))
    for ln in tail:
        if any(x in ln for x in ['lastIncomingText','churnLearn','FROZEN','is not defined','Ошибка обработки']):
            print(ln[:240])
PY
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node -e 'const h=require("./services/history"); console.log("hist_fn", typeof h.lastIncomingText);'
# replyPipeline pulls telegram etc — just grep that import exists in loaded file
node -e 'const fs=require("fs"); const t=fs.readFileSync("./services/replyPipeline.js","utf8"); console.log("has_import", /lastIncomingText,/.test(t)); console.log("churn_col", /churn_signal VARCHAR/.test(fs.readFileSync("./services/churnLearn.js","utf8")));'
# wait and recheck NEW errors only via out log markers
sleep 20
echo '--- err after wait (last 15 non-empty) ---'
tail -40 /root/.pm2/logs/tgbot-error.log | grep -vE '^\s*(at |\{|\}|options:|proxy:|command:|timeout:|destination:|host:|port:|type:|userId:|password:)' | tail -15
echo '--- replies ---'
grep 'Ответ для' /root/.pm2/logs/tgbot-out.log | tail -8
