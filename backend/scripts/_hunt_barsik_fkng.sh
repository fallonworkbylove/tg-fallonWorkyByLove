#!/bin/bash
set -euo pipefail
OUT=/root/.pm2/logs/tgbot-out.log

echo "=== all BarsikF replies ==="
grep 'Ответ для BarsikF' "$OUT" || true

echo
echo "=== Fkng / mur / fkng ==="
grep -iE 'Ответ для.*(Fkng|mur|Barsik)' "$OUT" | tail -80 || true

echo
echo "=== Машенька replies with это я / пример / борода / кайф to same peers ==="
python3 - <<'PY'
from pathlib import Path
import re
from collections import defaultdict

lines = Path('/root/.pm2/logs/tgbot-out.log').read_text(encoding='utf-8', errors='replace').splitlines()
acc_re = re.compile(r'\[(\d+)\s*—\s*([^\]]+)\]\s*Ответ для\s+([^:]+):\s*"(.*)"\s*$')

# group by (phone, peer)
by = defaultdict(list)
for ln in lines:
    if 'Ответ для' not in ln:
        continue
    m = acc_re.search(ln)
    if not m:
        # multiline truncated
        m2 = re.search(r'\[(\d+)\s*—\s*([^\]]+)\]\s*Ответ для\s+([^:]+):\s*"(.*)', ln)
        if not m2:
            continue
        phone, name, peer, text = m2.group(1), m2.group(2), m2.group(3), m2.group(4)
    else:
        phone, name, peer, text = m.group(1), m.group(2), m.group(3), m.group(4)
    by[(phone, peer.strip())].append((name.strip(), text))

markers = re.compile(
    r'да,\s*это\s+я|немного\s+повезло\s+сегодня|просто\s+пример|как\s+можно\s+заработать|борода|это\s+же\s+ты|кайф',
    re.I,
)

print('peers with ≥2 marker hits:')
for (phone, peer), msgs in sorted(by.items(), key=lambda x: -len([1 for _,t in x[1] if markers.search(t)])):
    hits = [(n,t) for n,t in msgs if markers.search(t)]
    if len(hits) < 2:
        continue
    # prefer mashenka / high hit
    print(f'\n--- {phone} peer={peer} markers={len(hits)} total_replies={len(msgs)} ---')
    for n, t in msgs:
        flag = ' *' if markers.search(t) else ''
        print(f'  [{n}] {t[:160]}{flag}')
PY
