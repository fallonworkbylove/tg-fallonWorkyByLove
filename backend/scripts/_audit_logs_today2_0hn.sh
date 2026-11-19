#!/bin/bash
set -euo pipefail
cd /root/.pm2/logs

echo "=== FILES ==="
ls -lah tgbot-out* tgbot-error* | sed -n '1,30p'

echo
echo "=== CURRENT OUT (full, small) ==="
wc -l tgbot-out.log tgbot-error.log
cat tgbot-out.log

echo
echo "=== CURRENT ERR ==="
cat tgbot-error.log

echo
echo "=== ROTATED named 2026-11-03 (usually previous calendar day content) head/tail ==="
# pm2-logrotate: file dated D contains logs until rotation at start of D
python3 - <<'PY'
from collections import Counter
import re, glob, os

def load(paths, max_mb=20):
    chunks=[]
    for p in paths:
        if not os.path.exists(p):
            continue
        with open(p,'rb') as f:
            f.seek(0,2); n=f.tell()
            f.seek(max(0,n-max_mb*1024*1024))
            chunks.append(f.read().decode('utf-8','replace'))
    return '\n'.join(chunks)

# Today MSK 2026-11-03: current logs + any file modified today
paths_out=['tgbot-out.log']
paths_err=['tgbot-error.log']
# Also include rotated that may contain Nov 3 timestamps
for p in sorted(glob.glob('tgbot-out*.log')+glob.glob('tgbot-error*.log')):
    if p in ('tgbot-out.log','tgbot-error.log'):
        continue
    # include Nov 2 and Nov 3 rotated
    if '2026-11-02' in p or '2026-11-03' in p:
        if 'out' in p: paths_out.append(p)
        if 'error' in p: paths_err.append(p)

out=load(paths_out)
err=load(paths_err)
print('sources_out', paths_out)
print('sources_err', paths_err)

# Filter to Nov 3 UTC stamps OR lines after last Nov 2 if few stamps
def day_lines(text, day='2026-11-03'):
    lines=text.splitlines()
    hit=[l for l in lines if day in l]
    return hit, lines

out3, out_all = day_lines(out)
err3, err_all = day_lines(err)
print('out_lines_with_2026-11-03', len(out3), 'of', len(out_all))
print('err_lines_with_2026-11-03', len(err3), 'of', len(err_all))

# If gramjs timestamps sparse, also take ALL current file (already in out_all from current)
# Analyze Nov 3 tagged + entire current small logs already concatenated

use_out = out3 if len(out3)>20 else out_all[-15000:]
use_err = err3 if len(err3)>20 else err_all[-8000:]
print('analyzing_out', len(use_out), 'err', len(use_err))

replies=[l for l in use_out if 'Ответ для' in l]
models=[l for l in use_out if 'Запрос к модели' in l]
boots=[l for l in use_out if 'Server is running' in l]
warm=[l for l in use_out if 'Warm TG' in l]
proxyboot=[l for l in use_out if 'Work (DC)' in l or 'Login (residential)' in l]
print('--- OUT ---')
print('boots', len(boots))
print('replies', len(replies))
print('model_calls', len(models))
print('warm_lines', len(warm))
acc=Counter()
for l in replies:
    m=re.search(r'\[(\d+)\s+[—\-]', l)
    if m: acc[m.group(1)]+=1
print('replies_by_phone_prefix:')
for a,c in acc.most_common(15):
    print(f'  {a}: {c}')
for l in warm[-6:]:
    print('WARM', l[-200:])
for l in boots[-5:]:
    print('BOOT', l[-120:])

print('--- ERR ---')
keys=Counter()
for l in use_err:
    if 'SocksClient' in l or 'invalid Socks5' in l or 'Proxy connection timed out' in l:
        keys['socks']+=1
    elif 'long polling' in l:
        keys['notifier_long_poll']+=1
    elif 'helpRequestNotifier' in l and 'fetch failed' in l:
        keys['notifier_fetch']+=1
    elif 'SESSION_WATCH' in l:
        keys['session_watch']+=1
    elif 'Network is unreachable' in l or 'ECONNREFUSED' in l:
        keys['net']+=1
    elif 'OpenAI' in l or 'openai' in l or 'Connection error' in l:
        keys['openai_conn']+=1
    elif 'ERROR' in l or 'Error' in l or 'FAIL' in l:
        keys['other']+=1
for k,v in keys.most_common():
    print(f'  {k}: {v}')
sw=[l for l in use_err if 'SESSION_WATCH' in l]
print('session_watch last:')
for l in sw[-10:]:
    print(' ', l[-150:])
np=[l for l in use_err if 'long polling' in l]
if np:
    # extract streak numbers
    streaks=[]
    for l in np:
        m=re.search(r'×(\d+)', l)
        if m: streaks.append(int(m.group(1)))
    print('long_poll events', len(np), 'max_streak', max(streaks) if streaks else None, 'last', streaks[-1] if streaks else None)
    print(' first', np[0][-130:])
    print(' last', np[-1][-130:])

# Timeline: first/last Nov3 gramjs connect errors
ts=re.findall(r'2026-11-03T\d{2}:\d{2}:\d{2}', out+'\n'+err)
if ts:
    print('timestamps_nov3', ts[0], '...', ts[-1], 'count', len(ts))
PY

echo
echo "=== journal ssh/nginx today (brief) ==="
journalctl --since "2026-11-03 00:00:00" -u nginx --no-pager 2>/dev/null | tail -5 || true
echo "pm2 flush? last rotate:"
ls -la /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log
