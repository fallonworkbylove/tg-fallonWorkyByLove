#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== voice file sizes ==="
ls -la voices/*.ogg | awk '{print $5, $9}' | sort -n
echo
echo "=== voprosy duration via python ==="
python3 - <<'PY'
import os, struct
p='voices/voprosy.ogg'
print('size', os.path.getsize(p))
# rough: look for OpusHead
data=open(p,'rb').read()
print('magic', data[:4], 'has OpusHead', b'OpusHead' in data[:200])
PY
echo
echo "=== Lera outbound voice (all logs) ==="
grep -aE '79675561759.*outbound voice|Лера\].*outbound voice|Лера\].*голосовое|Лера\].*Заготовка|Лера\].*voprosy' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -50 || true
echo
echo "=== bardak in all log files ==="
grep -aHl 'bardak0528' /root/.pm2/logs/tgbot-out*.log 2>/dev/null || true
grep -aE 'bardak0528' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | grep -iE 'voice|голос|voprosy|отправил|sendVoice|Пауза|Ответ|подъём|привет' | head -60 || true
echo
echo "=== triggers for привет ==="
python3 - <<'PY'
import json
from pathlib import Path
for p in [Path('voices/triggers.json'), Path('../voices/triggers.json')]:
  if p.exists():
    data=json.loads(p.read_text(encoding='utf-8'))
    for r in data if isinstance(data,list) else data.get('triggers',data.get('rules',[])):
      kws=r.get('keywords') or r.get('keys') or []
      if any('привет' in str(k).lower() or 'хай' in str(k).lower() for k in kws):
        print(p, r)
PY
