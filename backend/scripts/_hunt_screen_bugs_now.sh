#!/bin/bash
# Hunt screenshot-example bugs: after last session restore vs full log
set -euo pipefail
python3 <<'PY'
from pathlib import Path
import re

out = Path('/root/.pm2/logs/tgbot-out.log').read_text(encoding='utf-8', errors='replace').splitlines()
fresh_start = 0
for i, ln in enumerate(out):
    if 'Восстановление сессий завершено' in ln:
        fresh_start = i
replies = [ln for ln in out[fresh_start:] if 'Ответ для' in ln]
all_replies = [ln for ln in out if 'Ответ для' in ln]
print(f'fresh_from={fresh_start} fresh_replies={len(replies)} total_replies={len(all_replies)}')

patterns = [
    ('1_claim_self', re.compile(r'да,\s*это\s+я|немного\s+повезло\s+сегодня|да-да,\s*это\s+я', re.I)),
    ('2_beard_peer_photo', re.compile(r'борода\s+тебе|это\s+же\s+ты\)|ты\s+на\s+(?:фото|фотк)', re.I)),
    ('3_example_earn', re.compile(r'просто\s+пример|как\s+можно\s+заработать|крутые\s+заработки', re.I)),
    ('5_kaif_bare', re.compile(r'Ответ для.*"(?:ага,\s*)?кайф"?\s*$', re.I)),
    ('6_name_anya', re.compile(r'я\s+Аня', re.I)),
    ('7_dangling_no', re.compile(r'"(?:мило|всё хорошо|хаха,\s*да|хах,\s*приятно),\s*но"?\s*$', re.I)),
    ('8_nft_formal', re.compile(r'трейдер\s+NFT|цифровыми\s+актив', re.I)),
]

print('\n=== AFTER last session restore (current process) ===')
for key, rx in patterns:
    hits = [ln for ln in replies if rx.search(ln)]
    print(f'{key}: {len(hits)}')
    for h in hits[-4:]:
        print(' ', h[-200:])

voice = [ln for ln in out[fresh_start:] if 'Отправлено только голосовое' in ln]
print(f'4_voice_only: {len(voice)}')
for h in voice[-5:]:
    print(' ', h[-200:])

print('\n=== peers BarsikF / . (fresh) ===')
for needle in ['BarsikF', 'Ответ для .:', 'голосовое (без текста) для .']:
    rows = [ln for ln in out[fresh_start:] if needle in ln]
    print(f'{needle!r}: {len(rows)}')
    for ln in rows[-6:]:
        print(' ', ln[-180:])

print('\n=== FULL LOG (includes pre-fix) ===')
for key, rx in patterns:
    hits = [ln for ln in all_replies if rx.search(ln)]
    print(f'{key}: {len(hits)}')
voice_all = [ln for ln in out if 'Отправлено только голосовое' in ln]
print(f'4_voice_only: {len(voice_all)}')
for h in voice_all[-3:]:
    print(' ', h[-160:])
print('HUNT_DONE')
PY
