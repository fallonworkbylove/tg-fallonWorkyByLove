#!/bin/bash
# Реальные дыры: утечки в OUT, не метки БД.
set -euo pipefail
echo "=== OUT leaks last 2000 lines ==="
OUT=$(pm2 logs tgbot --out --lines 2000 --nostream 2>/dev/null | sed 's/^[^|]*| //' || true)
echo -n "Ответ с [медиа:#]: "; echo "$OUT" | grep 'Ответ для' | grep -c '\[медиа:#' || true
echo -n "Ответ с {фото:}: "; echo "$OUT" | grep 'Ответ для' | grep -c '{фото:' || true
echo -n "Ответ могу показать: "; echo "$OUT" | grep 'Ответ для' | grep -ci 'могу показать' || true
echo -n "sk-test in ERR last 50: "; pm2 logs tgbot --err --lines 50 --nostream 2>/dev/null | grep -c sk-test || true
echo "=== sample time pair from hunt ==="
python3 - <<'PY'
import json
from pathlib import Path
d=json.loads(Path('/tmp/dual_hunt.json').read_text())
for h in d.get('holes_all',[]):
  if h.get('kind')=='time_pair':
    print(h)
  if h.get('kind')=='soft_pitch_6h':
    print('PITCH', h)
  if h.get('kind')=='bad_reply_6h' and 'медиа' not in str(h.get('text','')):
    print('BAD', h)
PY
echo "=== watch so far ==="
cat /tmp/dual_watch.tsv 2>/dev/null || true
pgrep -af dual_hard | head -2
