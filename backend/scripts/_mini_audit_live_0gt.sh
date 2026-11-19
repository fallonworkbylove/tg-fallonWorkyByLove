#!/bin/bash
set -euo pipefail
echo '=== mini live pairs (last replies) ==='
python3 - <<'PY'
from pathlib import Path
import re
t=Path('/root/.pm2/logs/tgbot-out.log').read_bytes().decode('utf-8','replace')[-200000:]
answers=[ln for ln in t.splitlines() if 'Ответ для' in ln][-12:]
bad=0
for ln in answers:
    print(ln[:220])
    low=ln.lower()
    if 'не расслышала' in low or 'чего-чего' in low:
        # flag only if looks paired with normal - soft
        pass
    if '<<react' in low:
        bad+=1
        print('  ! leaked react token')
    if low.count('?')>=2 and 'ответ для' in low:
        bad+=1
        print('  ! multi-question smell')
print('flagged', bad)
PY
echo '=== proxy/session ==='
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];pl=p["pm2_env"].get("PROXY_LIST")or"";print({"status":p["pm2_env"]["status"],"proxy":len([x for x in pl.split(";")if x.strip()])})'
grep -aE 'Warm TG:|PROXY_WATCH|SESSION_WATCH|AI замолчал|schedulers' /root/.pm2/logs/tgbot-out.log | tail -15
echo '=== classic greps ==='
grep -aE 'ответил, сколько на дв|отсев \+ архив|outbound ' /root/.pm2/logs/tgbot-out.log | tail -15 || true
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY' /root/.pm2/logs/tgbot-error.log | tail -10 || true
echo MINI_AUDIT_0GT_DONE
