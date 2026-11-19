#!/bin/bash
# 15 мин live-watch БЕЗ рестарта AI.
OUT=/tmp/live_watch_15m.txt
ERRL=/root/.pm2/logs/tgbot-error.log
OUTL=/root/.pm2/logs/tgbot-out.log
: > "$OUT"
START_N=$(grep -c "Ответ для" "$OUTL" 2>/dev/null || echo 0)
ERR_MARK=$(wc -l < "$ERRL")
echo "LIVE_WATCH_START $(date -Is) start_replies=$START_N" | tee -a "$OUT"

SMELL='ну ок|это ну ок|цифров(ые|ых) актив|трейдер NFT|раньше ушло|как ты справляешься|я Аня|борода тебе|да, это я\)|второй девушк|Отправлено только голосовое|is not defined|мило, но|всё хорошо, но'

for i in $(seq 1 15); do
  echo "" | tee -a "$OUT"
  echo "=== TICK $i/15 $(date -Is) ===" | tee -a "$OUT"
  node -e '
const {execSync}=require("child_process");
const j=JSON.parse(execSync("pm2 jlist",{encoding:"utf8"}));
const p=j.find(x=>x.name==="tgbot");
const e=p.pm2_env||{};
const pl=e.PROXY_LIST||"";
console.log(JSON.stringify({
  status:e.status,
  restarts:e.restart_time,
  proxy:pl.split(";").filter(Boolean).length,
  dead:/168\.80\.83\.53|185\.168\.250/.test(pl),
}));
' 2>/dev/null | tee -a "$OUT"
  NOW_N=$(grep -c "Ответ для" "$OUTL" 2>/dev/null || echo 0)
  echo "replies_total=$NOW_N delta=$((NOW_N-START_N))" | tee -a "$OUT"
  echo "-- last replies --" | tee -a "$OUT"
  grep -E "Ответ для" "$OUTL" 2>/dev/null | tail -8 | tee -a "$OUT"
  echo "-- smell (last 40 replies) --" | tee -a "$OUT"
  grep -E "Ответ для" "$OUTL" 2>/dev/null | tail -40 | grep -iE "$SMELL" | tee -a "$OUT" || echo "(clean)" | tee -a "$OUT"
  echo "-- voice/nft flags --" | tee -a "$OUT"
  tail -n 400 "$OUTL" 2>/dev/null | grep -E "Отправлено только голосовое|голосовое про NFT|flipping|Тихие часы|заготовк" | tail -8 | tee -a "$OUT" || echo "(none)" | tee -a "$OUT"
  echo "-- new err --" | tee -a "$OUT"
  tail -n +"$((ERR_MARK+1))" "$ERRL" 2>/dev/null | grep -E "is not defined|Ошибка обработки|churnLearn schema|ReferenceError|TypeError|AUTH_KEY|FROZEN" | tail -10 | tee -a "$OUT" || echo "(none)" | tee -a "$OUT"
  if [ "$i" -lt 15 ]; then sleep 60; fi
done

END_N=$(grep -c "Ответ для" "$OUTL" 2>/dev/null || echo 0)
echo "" | tee -a "$OUT"
echo "=== SUMMARY ===" | tee -a "$OUT"
echo "gained_replies=$((END_N-START_N)) in ~15min" | tee -a "$OUT"
echo "-- smell whole window (last gained+40) --" | tee -a "$OUT"
N=$((END_N - START_N + 40))
[ "$N" -lt 50 ] && N=50
grep -E "Ответ для" "$OUTL" 2>/dev/null | tail -"$N" | grep -iE "$SMELL" | tee -a "$OUT" || echo "(no smells)" | tee -a "$OUT"
echo "-- code errs window --" | tee -a "$OUT"
tail -n +"$((ERR_MARK+1))" "$ERRL" 2>/dev/null | grep -E "is not defined|Ошибка обработки|churnLearn schema|ReferenceError" | sort | uniq -c | sort -rn | head -15 | tee -a "$OUT" || echo "(none)" | tee -a "$OUT"
echo "LIVE_WATCH_END $(date -Is)" | tee -a "$OUT"
echo AGENT_LOOP_TICK_live15_done | tee -a "$OUT"
