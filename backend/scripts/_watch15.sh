#!/bin/bash
# Watch tgbot logs for 15 minutes after deploy
OUT=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log
OUT0=$(wc -c < "$OUT" 2>/dev/null || echo 0)
ERR0=$(wc -c < "$ERR" 2>/dev/null || echo 0)
echo "WATCH_START $(date -Is) out0=$OUT0 err0=$ERR0 pid=$(pm2 pid tgbot)"
for i in $(seq 1 15); do
  sleep 60
  OUTN=$(wc -c < "$OUT" 2>/dev/null || echo 0)
  ERRN=$(wc -c < "$ERR" 2>/dev/null || echo 0)
  echo "===== MINUTE $i $(date -Is) +out=$((OUTN-OUT0)) +err=$((ERRN-ERR0)) ====="
  if [ "$OUTN" -gt "$OUT0" ]; then
    tail -c $((OUTN-OUT0+400)) "$OUT" 2>/dev/null | tail -n 40
  else
    echo "(no new out)"
  fi
  echo "--- ERR new ---"
  if [ "$ERRN" -gt "$ERR0" ]; then
    NEWERR=$(tail -c $((ERRN-ERR0+400)) "$ERR" 2>/dev/null)
    echo "$NEWERR" | tail -n 30
    echo "$NEWERR" | grep -c 'getSeasonInfo is not a function' | xargs -I{} echo "getSeasonInfo_errors_in_window: {}"
  else
    echo "(no new err)"
  fi
  echo "--- SIGNALS ---"
  if [ "$OUTN" -gt "$OUT0" ]; then
    tail -c $((OUTN-OUT0+400)) "$OUT" 2>/dev/null | grep -iE 'Ошибка|error|fail|пустой AI|не разобрал|архив|FLOOD|Пауза|Отправлен|голосово|Фото распознан|в архиве|fallback|ReferenceError|TypeError|is not a function' | tail -n 25 || echo "(no signals)"
  fi
done
echo "WATCH_END $(date -Is)"
OUTN=$(wc -c < "$OUT" 2>/dev/null || echo 0)
ERRN=$(wc -c < "$ERR" 2>/dev/null || echo 0)
echo "TOTAL_NEW out=$((OUTN-OUT0)) err=$((ERRN-ERR0))"
echo "=== SUMMARY OUT ==="
if [ "$OUTN" -gt "$OUT0" ]; then
  tail -c $((OUTN-OUT0)) "$OUT" | grep -iE 'Ошибка|error|fail|пустой AI|не разобрал|архив|FLOOD|Пауза перед|Отправлен|голосово|Фото распознан|в архиве|fallback|is not a function|ReferenceError' | tail -n 80 || true
fi
echo "=== SUMMARY ERR ==="
if [ "$ERRN" -gt "$ERR0" ]; then
  tail -c $((ERRN-ERR0)) "$ERR" | tail -n 50
  echo "getSeasonInfo count:" $(tail -c $((ERRN-ERR0)) "$ERR" | grep -c 'getSeasonInfo is not a function' || true)
fi
