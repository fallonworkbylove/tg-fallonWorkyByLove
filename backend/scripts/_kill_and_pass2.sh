#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian

# Kill hung deploy shells (not tgbot itself)
pkill -f '_finish_10of10' 2>/dev/null || true
pkill -f 'catch-up-all' 2>/dev/null || true
# Kill the old bash -c deploy that curls without timeout
pgrep -af 'bash -c B=/root/opt/tgbot' | awk '{print $1}' | xargs -r kill 2>/dev/null || true
sleep 1

echo "=== before restart ==="
pm2 pid tgbot || true
pm2 describe tgbot | grep -E 'status|uptime|restarts|pid' | head -8

pm2 restart tgbot --update-env
# Wait until new pid and online
for i in $(seq 1 40); do
  sleep 3
  ST=$(pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const p=JSON.parse(d).find(x=>x.name==='tgbot');if(!p)return console.log('none');console.log(p.pm2_env.status+','+p.pid+','+Math.round((Date.now()-p.pm2_env.pm_uptime)/1000))}catch(e){console.log('err')}})")
  echo "t=${i}: $ST"
  echo "$ST" | grep -q '^online,' && {
    UP=$(echo "$ST" | cut -d, -f3)
    if [ "${UP:-999}" -lt 90 ]; then
      echo "restarted ok"
      break
    fi
  }
done

echo "=== after restart ==="
pm2 status tgbot | head -6

cd "$B/backend"
KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)
echo "=== catch-up (25s max) ==="
curl -sS --max-time 25 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all || echo 'catch-up timed/err'
echo

echo "=== PASS2 AUDIT ==="
node scripts/_audit_10of10_pass1.js
echo PASS2_DONE
