#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
PID=$(pm2 pid tgbot 2>/dev/null || true)
echo "=== process ==="
echo "pid=$PID"
ps -p "$PID" -o lstart=,etime= 2>/dev/null || true
echo
echo "=== ERR last 40 (non-empty) ==="
tail -80 /root/.pm2/logs/tgbot-error.log 2>/dev/null | grep -v '^$' | tail -40 || echo '(empty)'
echo
echo "=== recent user→bot pairs (last 2h OUT) ==="
# Pull recent inbound + outbound reply lines
pm2 logs tgbot --out --lines 400 --nostream 2>/dev/null | sed 's/^[^|]*| //' | grep -E ']: |Ответ для|Пауза|«Занята»|Слишком скоро|Ошибка|isContradictory|медиа|фото|voice|Стикер|скан|Name:|Кос:|Deus|Запрос к модели' | tail -200
echo
echo "=== last 25 replies only ==="
pm2 logs tgbot --out --lines 800 --nostream 2>/dev/null | sed 's/^[^|]*| //' | grep 'Ответ для' | tail -25
echo
echo "=== last 25 inbound ==="
pm2 logs tgbot --out --lines 800 --nostream 2>/dev/null | sed 's/^[^|]*| //' | grep -E '\] [^:]+: "' | grep -v 'Ответ для' | grep -v 'Дневная' | tail -25
echo
echo "=== suspicious patterns in last 1500 OUT ==="
OUT=$(pm2 logs tgbot --out --lines 1500 --nostream 2>/dev/null | sed 's/^[^|]*| //')
echo -n "errors: "; echo "$OUT" | grep -cE 'Ошибка|isContradictory|ECONNREFUSED|TypeError|ReferenceError' || true
echo -n "empty-ish replies (ага/угу alone-ish): "; echo "$OUT" | grep 'Ответ для' | grep -ciE 'Ответ для [^:]+: "(ага|угу|ок|да|нет|хм|эмм)\.?\)?"' || true
echo -n "media tag leak: "; echo "$OUT" | grep -cE '\[PHOTO|\[VOICE|\[STICKER|MEDIA_TAG' || true
echo -n "AI assistant leaks: "; echo "$OUT" | grep -ciE 'как (ИИ|бот|нейросеть|языковая модель)|я (ИИ|бот|нейросеть)' || true
echo DONE
