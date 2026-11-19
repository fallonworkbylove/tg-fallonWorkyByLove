#!/bin/bash
set -euo pipefail
PEER=suport_service_v
echo "=== ALL LOG HITS for $PEER ==="
# include rotated
for f in /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-out__*.log; do
  [ -f "$f" ] || continue
  hits=$(grep -aF "$PEER" "$f" | wc -l || true)
  echo "FILE $f hits=$hits"
done

echo "=== FIRST mentions (flip/nft/кампан) ==="
# dump chronological-ish: oldest rotated first
for f in $(ls -1tr /root/.pm2/logs/tgbot-out__*.log /root/.pm2/logs/tgbot-out.log 2>/dev/null); do
  grep -aF "$PEER" "$f" | grep -aEi 'флип|nft|токен|pitch|кампан|Daily flip|voice|Ответ|outbound' || true
done | head -120

echo "=== FIRST ANY line for peer ==="
for f in $(ls -1tr /root/.pm2/logs/tgbot-out__*.log /root/.pm2/logs/tgbot-out.log 2>/dev/null); do
  grep -aF "$PEER" "$f" | head -5 && echo "(from $f)" && break
done

echo "=== DB ==="
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
cp -a /tmp/_probe_suport_nft.js scripts/ 2>/dev/null || true
node scripts/_probe_suport_nft.js
