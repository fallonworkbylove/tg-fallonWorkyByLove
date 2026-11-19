#!/bin/bash
# Poll until bootstrap done or 6 min
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  python3 - <<'PY'
from pathlib import Path
out=Path('/root/.pm2/logs/tgbot-out.log').read_text('utf-8','replace')
i=out.rfind('[proxy] Warm TG: OK')
chunk=out[i:] if i>=0 else ''
act=chunk.count(': активирован')
err=chunk.count(': ошибка')
rev=chunk.count('сессия мертва')
done='Восстановление сессий завершено' in chunk
warm=chunk.splitlines()[0] if chunk else '?'
print(f'act={act} err={err} rev={rev} done={done} | {warm[:120]}')
open('/tmp/boot_stat.txt','w').write(f'{act} {err} {rev} {int(done)}\n')
PY
  read a e r d < /tmp/boot_stat.txt
  if [ "$d" = "1" ]; then
    echo BOOTSTRAP_DONE
    grep -aE 'Аккаунт|Warm TG:|заверш' /root/.pm2/logs/tgbot-out.log | tail -30
    exit 0
  fi
  sleep 30
done
echo BOOTSTRAP_TIMEOUT
grep -aE 'Аккаунт|Warm TG:|заверш' /root/.pm2/logs/tgbot-out.log | tail -40
exit 0
