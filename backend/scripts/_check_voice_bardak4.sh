#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== rotated logs bardak ==="
ls -la /root/.pm2/logs/tgbot-out* | head -20
for f in /root/.pm2/logs/tgbot-out*.log*; do
  echo "-- $f --"
  grep -a 'bardak0528' "$f" 2>/dev/null | head -5 || true
  grep -a 'bardak0528' "$f" 2>/dev/null | grep -iE 'voice|голос|voprosy|Заготовка|outbound' | head -10 || true
done
echo
echo "=== any voice near 13:21 today Lera ==="
grep -aE '79675561759' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | grep -iE 'voice|голос|voprosy|Отправлено только' | head -40 || true
echo
echo "=== sendVoiceReply / saveMessage voice tag ==="
grep -n 'голосовое\|saveMessage.*voice\|voiceTag' services/voiceReplies.js services/replyPipeline.js | head -30
echo
echo "=== opus duration estimate ==="
python3 - <<'PY'
# parse Ogg pages rough duration via granule if possible
import os
for name in sorted(os.listdir('voices')):
  if not name.endswith('.ogg') and 'ogg' not in name: 
    p=os.path.join('voices', name)
    if os.path.isfile(p):
      print(name, os.path.getsize(p))
  p=os.path.join('voices', name)
  if not os.path.isfile(p):
    continue
  if not (name.endswith('.ogg') or '.' not in name):
    # also files without extension weird
    pass
  data=open(p,'rb').read()
  # count OggS pages
  pages=data.count(b'OggS')
  print(f'{name}: bytes={len(data)} pages≈{pages}')
PY
ls -la voices/
