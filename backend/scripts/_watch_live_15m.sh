#!/bin/bash
# Live watch ~12 min: 6 snaps × 2 min. Report smells + code errs + reply rate.
set -euo pipefail
OUT=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log

start_n=$(grep -c "Ответ для" "$OUT" || true)
start_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "WATCH_START replies=$start_n at=$start_ts"

# baseline err marker
err_mark=$(wc -l < "$ERR")

smell_re='ну ок|это ну ок|цифров(ые|ых) актив|трейдер NFT|раньше ушло|как ты справляешься|с этим ожиданием|напшсал|когва|кпкую|молрдец|янаарь|тольуо|я Аня|я Маша|я Юля|я Катя'

for i in 1 2 3 4 5 6; do
  sleep 120
  now_n=$(grep -c "Ответ для" "$OUT" || true)
  delta=$((now_n - start_n))
  echo ""
  echo "=== snap$i $(date -u +%H:%M:%S) total=$now_n delta=+$delta ==="
  grep "Ответ для" "$OUT" | tail -8

  echo "-- smell (last 25 replies) --"
  grep "Ответ для" "$OUT" | tail -25 | grep -iE "$smell_re" || echo "(clean)"

  echo "-- new err since start --"
  tail -n +"$((err_mark+1))" "$ERR" 2>/dev/null | grep -E 'is not defined|Ошибка обработки|churnLearn schema|AUTH_KEY|SocksClientError|FROZEN|ReferenceError|TypeError' | tail -12 || echo "(none)"

  node -e '
const {execSync}=require("child_process");
const j=JSON.parse(execSync("pm2 jlist",{encoding:"utf8"}));
const p=j.find(x=>x.name==="tgbot");
const e=p.pm2_env||{};
const pl=e.PROXY_LIST||"";
console.log("status", e.status, "proxy", pl.split(";").filter(Boolean).length, "dead", /168\.80\.83\.53|185\.168\.250/.test(pl));
' 2>/dev/null || true
done

end_n=$(grep -c "Ответ для" "$OUT" || true)
echo ""
echo "WATCH_END gained=$((end_n-start_n)) in ~12min"
grep "Ответ для" "$OUT" | tail -15

echo "-- all smells this window (approx last gained*2 lines) --"
# rough: last N reply lines where N = gained+20
n=$((end_n - start_n + 30))
[ "$n" -lt 40 ] && n=40
grep "Ответ для" "$OUT" | tail -"$n" | grep -iE "$smell_re" || echo "(no smells)"

echo "-- all code issues this window --"
tail -n +"$((err_mark+1))" "$ERR" 2>/dev/null | grep -E 'is not defined|Ошибка обработки|churnLearn schema|AUTH_KEY|ReferenceError' | sort | uniq -c | sort -rn | head -20 || echo "(none)"
echo WATCH_15_DONE
