#!/bin/bash
# Fresh-only speech + code bugs since last restart (~14:43Z)
set -euo pipefail
OUT=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log

# Cut log after last "Work (DC) пул: 9"
python3 - <<'PY'
from pathlib import Path
import re
out = Path('/root/.pm2/logs/tgbot-out.log').read_text(encoding='utf-8', errors='replace').splitlines()
err = Path('/root/.pm2/logs/tgbot-error.log').read_text(encoding='utf-8', errors='replace').splitlines()

# find last "пул: 9" line index
cut = 0
for i, ln in enumerate(out):
    if 'Work (DC) пул: 9' in ln:
        cut = i
fresh = out[cut:]
print(f'fresh_lines={len(fresh)} cut_at={cut}')

replies = [ln for ln in fresh if 'Ответ для' in ln]
print(f'fresh_replies={len(replies)}')
print('--- last 40 fresh replies ---')
for ln in replies[-40:]:
    print(ln)

bugs = []
patterns = [
    (r'ну ок|это ну ок', 'nu_ok'),
    (r'цифров(ые|ых) актив|трейдер NFT|работаю с цифровыми', 'nft_formal'),
    (r'раньше ушло|\[photo\]|\[voice\]|MEDIA_', 'media_leak'),
    (r'как ты справляешься|с этим ожиданием|что ты чувствуешь по поводу', 'coach'),
    (r'напшсал|когва|кпкую|молрдец|янаарь|приветик\)\s*ну ок', 'typo_or_weird'),
]
print('--- fresh speech hits ---')
hits = {k: [] for _, k in patterns}
for ln in replies:
    low = ln.lower()
    for pat, key in patterns:
        if re.search(pat, ln, re.I):
            hits[key].append(ln)
for k, arr in hits.items():
    print(f'{k}: {len(arr)}')
    for x in arr[-8:]:
        print(' ', x[-180:])

print('--- fresh err (tail after restart markers) ---')
# err has no timestamps always; show last 30 non-stack
interesting = []
for ln in err[-200:]:
    if any(s in ln for s in [
        'lastIncomingText', 'churnLearn', 'FROZEN', 'AUTH_KEY', 'Ошибка обработки',
        'SocksClientError', 'fetch failed', 'Not connected', 'is not defined', 'TypeError', 'ReferenceError'
    ]):
        interesting.append(ln)
for ln in interesting[-40:]:
    print(ln[:220])
PY
