#!/bin/bash
# Snapshot live tgbot logs (out + err) for operator watch.
set -euo pipefail
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) tgbot watch ==="
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
pl=e.get('PROXY_LIST')or''
print({'status':e['status'],'uptime':e.get('pm_uptime'),'restarts':e.get('restart_time'),
       'PROXY':len([x for x in pl.split(';') if x.strip()])})
PY
echo "--- out (last 40 interesting) ---"
grep -aE 'ERROR|WARN|мусор|отсев|outbound |AI silence|OPENAI|proxy|SOCKS|REFUSE|text_promises|later_text|nearDup|FROZEN|PEER_ID|занят|busy|ответил' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -40 || true
echo "--- err (last 25) ---"
tail -n 25 /root/.pm2/logs/tgbot-error.log 2>/dev/null || true
echo WATCH_SNAP_OK
