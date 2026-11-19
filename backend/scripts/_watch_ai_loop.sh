#!/bin/bash
# 3 snapshots over ~2.5 min
set -euo pipefail
OUT=/root/.pm2/logs/tgbot-out.log
marker0=$(grep -c "Ответ для" "$OUT" || true)
echo "start_replies=$marker0 at=$(date -u +%H:%M:%S)"

for i in 1 2 3; do
  sleep 50
  now=$(grep -c "Ответ для" "$OUT" || true)
  delta=$((now - marker0))
  echo "--- snap$i at=$(date -u +%H:%M:%S) total=$now delta_since_start=+$delta ---"
  grep "Ответ для" "$OUT" | tail -6
  # speech smell on last 15
  echo "smell:"
  grep "Ответ для" "$OUT" | tail -15 | grep -iE 'ну ок|цифров(ые|ых) актив|трейдер NFT|раньше ушло|как ты справляешься|ожидани|напшсал|когва|янаарь' || echo "  (clean)"
  # new code errors
  python3 - <<'PY'
from pathlib import Path
err=Path('/root/.pm2/logs/tgbot-error.log').read_text(encoding='utf-8',errors='replace').splitlines()
idxs=[i for i,l in enumerate(err) if 'setMyCommands' in l]
tail=err[idxs[-1]:] if idxs else []
bad=[ln for ln in tail if any(x in ln for x in ['is not defined','churnLearn schema','Ошибка обработки'])]
print(f'  code_errs_since_restart={len(bad)}')
if bad[-3:]:
  for ln in bad[-3:]: print(' ', ln[:160])
PY
done

echo "=== FINAL ==="
marker1=$(grep -c "Ответ для" "$OUT" || true)
echo "replies_gained=$((marker1-marker0)) in ~2.5min"
grep "Ответ для" "$OUT" | tail -12
echo LOOP_DONE
