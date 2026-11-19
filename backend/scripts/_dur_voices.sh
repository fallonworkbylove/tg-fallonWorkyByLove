#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend/voices
python3 - <<'PY'
import os, struct
def dur(path):
  data=open(path,'rb').read()
  last=0
  i=0
  while True:
    i=data.find(b'OggS', i)
    if i<0: break
    if i+14<=len(data):
      g=int.from_bytes(data[i+6:i+14],'little')
      if g: last=g
    i+=4
  return last/48000.0
for name in sorted(os.listdir('.')):
  if not name.endswith('.ogg'): continue
  p=os.path.join('.',name)
  print(f'{name}: {os.path.getsize(p)}b ~{dur(p):.2f}s')
PY
grep -aE 'kak_prohodit|silence.*voice|SILENCE_VOICE|outbound voice peer=bardak|silenceCatchup|тишин' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -30 || true
grep -n 'kak_prohodit\|SILENCE_VOICE' /root/opt/tgbot/tg-miniapp-loverussian/backend/services/*.js | head -20
