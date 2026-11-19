#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend"
eval "$(python3 - <<'PY'
import re
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
keys=['MYSQL_HOST','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE','MYSQL_PORT',
      'DB_HOST','DB_USER','DB_PASS','DB_PASSWORD','DB_NAME','DB_DATABASE',
      'OPENAI_API_KEY','PROXY_LIST']
for key in keys:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    val=m.group(1).strip()
    if (val.startswith('"')and val.endswith('"'))or(val.startswith("'")and val.endswith("'")): val=val[1:-1]
    print("export %s='%s'"%(key,val.replace("'","'\"'\"'")))
PY
)"
# show which db keys exist (names only)
python3 - <<'PY'
import os
for k in sorted(os.environ):
    if 'MYSQL' in k or k.startswith('DB_'):
        print(k, 'set' if os.environ.get(k) else 'empty')
PY
node - <<'NODE'
const hh = require('./services/humanHardening');
(async () => {
  const aid = 91099;
  const pid = 'persist-0ge-' + Date.now();
  hh.noteExplicitInterest(aid, pid, 'rasskazhi podrobnee kak rabotaet flip tokeny');
  hh.noteExplicitInterest(aid, pid, 'interesno pokazi nft profit');
  await new Promise((r) => setTimeout(r, 800));
  hh.__testClearPeerMemory(aid, pid);
  const s = await hh.hydratePeerGates(aid, pid);
  console.log('PERSIST_HITS', s.interestHits);
  if (s.interestHits < 2) process.exit(2);
  console.log('PERSIST_OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
# ops updates path
echo "OPS_CANDIDATES:"
find /root/opt/tgbot -path '*/ops-console/app/updates.js' 2>/dev/null || true
find /var/www -name 'updates.js' 2>/dev/null | head -10 || true
ls -la "$BASE/frontend/updates.js" "$BASE/frontend/index.html"
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
grep -aF 'Десять из десяти' "$BASE/frontend/updates.js" | head -1
# fresh err noise after restart
sleep 2
echo "FROZEN_RECENT:"
grep -aE 'FROZEN_METHOD_INVALID|folders\.\* заморожены' /root/.pm2/logs/tgbot-err.log | tail -5 || true
echo "FETCH_RECENT:"
grep -aE 'Ошибка long polling|fetch failed' /root/.pm2/logs/tgbot-err.log | tail -5 || true
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; print({"status":p["pm2_env"]["status"],"proxy":len((p["pm2_env"].get("PROXY_LIST") or "").split(";")),"uptime":p["pm2_env"].get("pm_uptime")})'
echo VERIFY_0GE_DONE
