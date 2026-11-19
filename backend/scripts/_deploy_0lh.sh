#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0lh}
echo "=== deploy 0lh NFT live 90m ==="
cp -a "$SRC/nftCampaign.js" "$BASE/backend/services/nftCampaign.js"
cp -a "$SRC/_smoke_nft_live90_0lh.js" "$BASE/backend/scripts/_smoke_nft_live90_0lh.js"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
grep -q 'NFT_LIVE_DIALOG_MIN) || 90' "$BASE/backend/services/nftCampaign.js"
grep -q 'updates.js?v=239' "$BASE/frontend/index.html"
grep -q 'По работе» шире' "$BASE/frontend/updates.js"
grep -q '## 0lh\.' "$BASE/CHANGELOG_TG.md"
cd "$BASE/backend"
node scripts/_smoke_nft_live90_0lh.js
unset AUDIT_SMOKE || true
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',text,re.M)
if m: print('export PROXY_LIST=%s'%shlex.quote(m.group(1).strip()))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }
unset AUDIT_SMOKE || true
pm2 restart tgbot --update-env
pm2 save
sleep 3
bash scripts/_deploy_guard.sh
echo DONE_0lh
