#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend || exit 1
node <<'NODE'
const pp = require('./services/proxyPools');
console.log({
  conn: pp.isProxyTransportError(new Error('Connection error.')),
  api: pp.isProxyTransportError({ name: 'APIConnectionError', message: 'Connection error.' }),
});
NODE
python3 <<'PY'
from pathlib import Path
import time, subprocess, json
j=json.loads(subprocess.check_output(['pm2','jlist'], text=True))
p=[x for x in j if x['name']=='tgbot'][0]
uptime=int((time.time()*1000 - p['pm2_env']['pm_uptime'])/1000)
print('uptime_s', uptime, 'proxy', len([x for x in str(p['pm2_env'].get('PROXY_LIST') or '').split(';') if x.strip()]))
out=Path('/root/.pm2/logs/tgbot-out.log').read_text(errors='ignore').splitlines()
err=Path('/root/.pm2/logs/tgbot-error.log').read_text(errors='ignore').splitlines()
# after last restart marker
restart_idx=0
for i,l in enumerate(out):
    if 'Warm TG' in l or 'Work (DC) пул' in l:
        restart_idx=i
slice_out=out[restart_idx:]
slice_err=err[-200:]
print('sdoh_after_boot', sum(1 for l in slice_out if 'сдох' in l))
print('circuit_after_boot', sum(1 for l in slice_out if 'circuit OPEN' in l))
print('otvet_after_boot', sum(1 for l in slice_out if 'Ответ для' in l))
print('beri_after_boot', sum(1 for l in slice_out if 'Бери трубку' in l))
print('conn_err_last200', sum(1 for l in slice_err if 'Connection error' in l))
print('--- last otvet ---')
for l in [x for x in slice_out if 'Ответ для' in x][-8:]:
    print(l[:180])
print('--- last sdoh ---')
for l in [x for x in slice_out if 'сдох' in x][-8:]:
    print(l[:180])
print('--- last conn err ---')
for l in [x for x in slice_err if 'Connection error' in x][-8:]:
    print(l[:180])
PY
curl -sS -m 8 http://127.0.0.1:3000/api/health; echo
