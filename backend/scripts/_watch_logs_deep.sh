#!/bin/bash
set -euo pipefail
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) deep ==="
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json,time
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
pl=e.get('PROXY_LIST')or''
up=e.get('pm_uptime')or 0
print({'status':e['status'],'restarts':e.get('restart_time'),
       'uptime_min':round((time.time()*1000-up)/60000,1) if up else None,
       'PROXY':len([x for x in pl.split(';') if x.strip()])})
PY
echo "--- boot/sock ---"
grep -aE 'Bot API через SOCKS|text-promise|восстановлено text_promises|schedulers:' /root/.pm2/logs/tgbot-out.log | tail -8
echo "--- alerts ---"
grep -aE 'AI silence|REFUSE_PROXY|helpRequestNotifier|OPENAI|мусор →|markPeerFiltered отказ' /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -25
echo "--- recent replies ---"
grep -aE 'Ответ для |outbound ' /root/.pm2/logs/tgbot-out.log | tail -15
echo "--- err unique ---"
tail -n 80 /root/.pm2/logs/tgbot-error.log | sed 's/\x1b\[[0-9;]*m//g' | grep -aE 'Error|failed|REFUSE|OPENAI|helpRequest' | sort | uniq -c | sort -rn | head -15
echo DEEP_OK
