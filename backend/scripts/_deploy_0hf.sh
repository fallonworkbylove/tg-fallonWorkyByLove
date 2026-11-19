#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0hf}
echo "=== deploy 0hf anti-stub + silence + proxy purge ==="
cp -a "$SRC/humanHardening.js" "$BASE/backend/services/"
cp -a "$SRC/humanIdeas10.js" "$BASE/backend/services/"
cp -a "$SRC/opsQuality.js" "$BASE/backend/services/"
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/"
cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_antistub_silence_0hf.js" "$BASE/backend/scripts/"
[ -f "$SRC/_purge_openai_work_0hf.sh" ] && cp -a "$SRC/_purge_openai_work_0hf.sh" "$BASE/backend/scripts/"
[ -f "$SRC/_mega_hard_audit_0hf.sh" ] && cp -a "$SRC/_mega_hard_audit_0hf.sh" "$BASE/backend/scripts/"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
[ -f "$SRC/AUDIT_HARD_10OF10.md" ] && cp -a "$SRC/AUDIT_HARD_10OF10.md" "$BASE/"

cd "$BASE/backend"
node scripts/_smoke_antistub_silence_0hf.js

# Purge dead OpenAI/work socks before restart
bash scripts/_purge_openai_work_0hf.sh

eval "$(python3 - <<'PY'
import re
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    val=m.group(1).strip()
    if (val.startswith('"')and val.endswith('"'))or(val.startswith("'")and val.endswith("'")): val=val[1:-1]
    print("export %s=%s"%(key, __import__('shlex').quote(val)))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }
grep -q 'expandBareStubOnQuestion' "$BASE/backend/services/humanHardening.js"
grep -q 'Только явные кивки' "$BASE/backend/services/opsQuality.js"
grep -q 'лайф' "$BASE/backend/services/humanIdeas10.js"
pm2 restart tgbot --update-env
pm2 save
sleep 6
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];pl=p["pm2_env"].get("PROXY_LIST")or"";oa=p["pm2_env"].get("OPENAI_PROXY_LIST")or"";print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";")if x.strip()]),"pm2_OPENAI_LEN":len([x for x in oa.split(";")if x.strip()])})'
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
grep -q 'Меньше пустых' "$BASE/frontend/updates.js"
grep -q 'Меньше пустых' "$BASE/ops-console/app/updates.js"
echo DEPLOY_0HF_OK
