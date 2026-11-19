#!/bin/bash
set -e
F=/root/opt/tgbot/tg-miniapp-loverussian/frontend
grep -c 'updates.js?v=74' "$F/index.html"
wc -c "$F/updates.js"
grep -c 'title:' "$F/updates.js"
python3 - <<'PY'
p=open("/root/opt/tgbot/tg-miniapp-loverussian/frontend/updates.js","rb").read()
needle="Кабинет".encode("utf-8")
print("cabinet_ok", needle in p)
print("dryhla_ok", "дрыхла".encode("utf-8") in p)
PY
