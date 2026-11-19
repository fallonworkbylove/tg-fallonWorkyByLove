#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0jp}
echo "=== deploy 0jp voice promise/tag ==="

for f in voiceReplies.js aiResponderPostprocess.js replySendPrep.js replyPipeline.js aiResponder.js objectionHandler.js mediaSend.js; do
  [ -f "$SRC/$f" ] && cp -a "$SRC/$f" "$BASE/backend/services/"
done
[ -f "$SRC/triggers.json" ] && mkdir -p "$BASE/backend/voices" && cp -a "$SRC/triggers.json" "$BASE/backend/voices/"
cp -a "$SRC/_smoke_voice_promise_0jp.js" "$BASE/backend/scripts/"
cp -a "$SRC/_smoke_voprosy_dup_0jk.js" "$BASE/backend/scripts/" 2>/dev/null || true
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && mkdir -p "$BASE/ops-console/app" && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

sed -i 's/\r$//' scripts/_smoke_voice_promise_0jp.js scripts/_smoke_voprosy_dup_0jk.js || true
timeout 40 node scripts/_smoke_voice_promise_0jp.js
timeout 40 node scripts/_smoke_voprosy_dup_0jk.js || true

grep -q 'softVoiceAskWithoutFile' "$BASE/backend/services/voiceReplies.js"
grep -q 'за жизнь' "$BASE/backend/voices/triggers.json"
grep -q 'Голосовое без фейка' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=196' "$BASE/frontend/index.html"

pm2 stop tgbot
echo "waiting 95s..."
sleep 95
pm2 start tgbot --update-env
pm2 save
sleep 12
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
assert e['status']=='online' and n>=5
PY
curl -sS http://127.0.0.1:3000/api/health; echo
echo DONE_0jp
