#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
cp -f /tmp/nftCampaign.js services/nftCampaign.js
# soft reload not needed for audit; restart quick for strip fix
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
timeout 40 pm2 restart tgbot --update-env
sleep 2

SINCE=$(date -u +'%Y-%m-%d %H:%M:%S' -d '90 minutes ago')
echo "FIX_SINCE=$SINCE"
for n in 1 2 3; do
  echo "=== AUDIT $n ==="
  AUDIT_FIX_SINCE="$SINCE" node scripts/_ultra_hard_audit.js | tee /tmp/aud_s5r_$n.txt | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|findings.: \[' || true
done
python3 <<'PY'
import json
for n in (1,2,3):
  t=open(f'/tmp/aud_s5r_{n}.txt').read()
  i=t.index('{'); j=t.rindex('}')
  d=json.loads(t[i:j+1])
  print(f'audit{n}', d.get('overall'), d.get('checks'), d.get('findings'), d.get('score'))
PY
echo RESCORE_OK
