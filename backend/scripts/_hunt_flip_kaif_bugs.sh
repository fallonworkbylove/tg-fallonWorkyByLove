#!/bin/bash
# Hunt screenshot-like bugs in tgbot-out.log
set -euo pipefail
OUT=/root/.pm2/logs/tgbot-out.log

echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "log_lines=$(wc -l < "$OUT")"

python3 - <<'PY'
from pathlib import Path
import re
from collections import defaultdict

out = Path('/root/.pm2/logs/tgbot-out.log').read_text(encoding='utf-8', errors='replace').splitlines()
replies = [ln for ln in out if 'Ответ для' in ln]
print(f'total_replies={len(replies)}')

patterns = [
    ('claim_self_on_photo', re.compile(r'Ответ для.*"(?:да[,.\s)]*)?(?:это\s+)?я\)|да,\s*это\s+я|немного\s+повезло\s+сегодня|это\s+я\s+на\s+фото', re.I)),
    ('beard_compliment', re.compile(r'Ответ для.*борода', re.I)),
    ('claim_peer_is_photo', re.compile(r'Ответ для.*(?:это\s+же\s+ты|это\s+ты\s*\)|ты\s+на\s+(?:фото|фотк)|на\s+фото\s+ты)', re.I)),
    ('beautiful_fem', re.compile(r'Ответ для.*"[^"]*красивая\)?', re.I)),
    ('example_earn', re.compile(r'Ответ для.*(?:просто\s+пример|пример\s+(?:как|того)|как\s+можно\s+зарабатывать|пример\s+заработ)', re.I)),
    ('kaif_bare', re.compile(r'Ответ для.*"(?:ага,\s*)?кайф(?:\s*\)|\s*$|"|,)', re.I)),
    ('confused_name_anya', re.compile(r'Ответ для.*я\s+Аня', re.I)),
    ('dangling_no', re.compile(r'Ответ для.*"(?:мило|всё хорошо|хаха,\s*да|хах,\s*приятно),\s*но"?\s*$', re.I)),
]

hits = {k: [] for k, _ in patterns}
for ln in replies:
    for key, rx in patterns:
        if rx.search(ln):
            hits[key].append(ln)

for key, _ in patterns:
    arr = hits[key]
    print(f'\n=== {key}: {len(arr)} ===')
    for x in arr[-25:]:
        print(x[-220:])

# Cluster kaif storms: same account sending many kaif within nearby log lines
print('\n=== kaif storms (same phone, ≥4 kaif in window of 30 reply-lines) ===')
kaif_rx = re.compile(r'кайф', re.I)
acc_re = re.compile(r'\[(\d+)\s*—\s*([^\]]+)\]\s*Ответ для\s+([^:]+):')
# scan sliding
idxs = [i for i, ln in enumerate(replies) if kaif_rx.search(ln)]
storms = []
for i in idxs:
    window = replies[max(0, i - 15): i + 1]
    by = defaultdict(list)
    for ln in window:
        m = acc_re.search(ln)
        if not m or not kaif_rx.search(ln):
            continue
        by[m.group(1)].append(ln)
    for phone, arr in by.items():
        if len(arr) >= 4:
            storms.append((phone, arr[-1], len(arr)))

# unique by last line
seen = set()
uniq = []
for phone, last, n in storms:
    k = (phone, last[-80:])
    if k in seen:
        continue
    seen.add(k)
    uniq.append((n, phone, last))
uniq.sort(reverse=True)
for n, phone, last in uniq[:20]:
    print(f'  n={n} {last[-200:]}')

print('\n=== pairs: flip tag near claim_self (context ±3 reply lines) ===')
flipish = re.compile(r'профит|нфт|nft|флип|сделк|скрин|перепрод|токен', re.I)
claim = re.compile(r'да,\s*это\s+я|это\s+я\)|немного\s+повезло\s+сегодня', re.I)
for i, ln in enumerate(replies):
    if not claim.search(ln):
        continue
    ctx = replies[max(0, i - 4): i + 5]
    nearby = [c for c in ctx if flipish.search(c) or 'фото' in c.lower()]
    if nearby or True:
        print('---')
        for c in ctx:
            mark = '>>' if c is ln or c == ln else '  '
            print(mark, c[-200:])

print('\nHUNT_DONE')
PY
