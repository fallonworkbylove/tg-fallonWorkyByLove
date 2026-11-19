#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend"
eval "$(python3 - <<'PY'
import re
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','OPENAI_API_KEY','PROXY_LIST']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    val=m.group(1).strip()
    if (val.startswith('"')and val.endswith('"'))or(val.startswith("'")and val.endswith("'")): val=val[1:-1]
    print("export %s='%s'"%(key,val.replace("'","'\"'\"'")))
PY
)"

node - <<'NODE'
const db = require('./db');
(async () => {
  const q = `%Артур%`;
  const [peers] = await db.query(
    `SELECT id, account_id, peer_id, display_name, username, phone, created_at, last_message_at, archived, operator_note
     FROM peers
     WHERE display_name LIKE ? OR username LIKE ?
     ORDER BY last_message_at DESC LIMIT 30`,
    [q, q],
  ).catch(async (e) => {
    console.error('peers_err', e.message);
    // try alternate schema
    const [p2] = await db.query(`SHOW TABLES LIKE '%peer%'`);
    console.log('peer_tables', p2);
    return [[]];
  });
  console.log('PEERS', JSON.stringify(peers, null, 2));

  // also search chat_logs / messages for flip + Артур
  const [tables] = await db.query(`SHOW TABLES`);
  const names = tables.map((r) => Object.values(r)[0]);
  console.log('TABLES_HINT', names.filter((n) => /peer|chat|msg|nft|campaign|conv/i.test(n)).slice(0, 40));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE

echo '--- LOG GREP ---'
# recent logs mentioning flip / nft for Arthur-like peers
grep -aE 'Артур|флип|NFT|nftCampaign|tickNft|flip' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -80 || true
grep -aE 'Артур|флип' /root/.pm2/logs/tgbot-out.log* 2>/dev/null | tail -40 || true
ls -lt /root/.pm2/logs/tgbot-out* 2>/dev/null | head -10
