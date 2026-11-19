#!/bin/bash
set -euo pipefail
echo "=== post-add audit 0ie ==="
grep -aE 'text_promises|Bot API через SOCKS|opsQuality|мусор' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -25 || true
echo "--- err ---"
grep -aE 'REFUSE_PROXY|OPENAI|SocksClient|PEER_ID_INVALID' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -12 || true
echo "--- pm2 ---"
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
print({'status':e['status'],'PROXY':len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])})
PY
grep -oE 'updates.js\?v=[0-9]+' /root/opt/tgbot/tg-miniapp-loverussian/frontend/index.html | head -1
grep -q 'Память на неделю' /root/opt/tgbot/tg-miniapp-loverussian/frontend/updates.js && echo updates_ok
test -f /root/opt/tgbot/tg-miniapp-loverussian/backend/services/opsLiveMetrics.js && echo metrics_mod_ok
echo POST_AUDIT_0IE_OK
