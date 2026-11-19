#!/bin/bash
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];pl=p["pm2_env"].get("PROXY_LIST") or "";print("PROXY_LEN",len([x for x in pl.split(";") if x.strip()]));print("status",p["pm2_env"]["status"])'
python3 - <<'PY'
from pathlib import Path
out=Path('/root/.pm2/logs/tgbot-out.log').read_text('utf-8','replace')
i=out.rfind('[proxy] Warm TG: OK')
chunk=out[i:]
print(chunk.splitlines()[0])
print('activated', chunk.count(': активирован'))
print('error', chunk.count(': ошибка'))
print('done', 'Восстановление сессий завершено' in chunk)
print('scans', sum(1 for l in chunk.splitlines() if 'отвечено диалогам' in l))
PY
