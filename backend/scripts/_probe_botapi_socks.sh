#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
# load env keys we need
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['BOT_TOKEN','NOTIFY_BOT_TOKEN','PROXY_LIST','OPENAI_PROXY_LIST','BOT_API_PROXY','TELEGRAM_BOT_PROXY']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if m: print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
TOKEN="${NOTIFY_BOT_TOKEN:-${BOT_TOKEN:-}}"
echo "token_set=$([ -n "$TOKEN" ] && echo yes || echo no)"
echo "BOT_API_PROXY=${BOT_API_PROXY:-}"
echo "TELEGRAM_BOT_PROXY=${TELEGRAM_BOT_PROXY:-}"
# direct
code=$(curl -sS -o /tmp/tg_direct.json -w '%{http_code}' --connect-timeout 8 --max-time 15 "https://api.telegram.org/bot${TOKEN}/getMe" || echo fail)
echo "direct_http=$code body=$(head -c 120 /tmp/tg_direct.json 2>/dev/null || true)"
# via first socks5 from PROXY_LIST (socks5h)
FIRST=$(echo "$PROXY_LIST" | tr ';' '\n' | grep -m1 socks5 || true)
echo "first_proxy=$FIRST"
if [ -n "$FIRST" ]; then
  IFS=: read -r _ host port user pass <<<"$FIRST"
  code2=$(curl -sS -o /tmp/tg_socks.json -w '%{http_code}' --connect-timeout 12 --max-time 25 \
    --proxy "socks5h://${user}:${pass}@${host}:${port}" \
    "https://api.telegram.org/bot${TOKEN}/getMe" || echo fail)
  echo "socks_http=$code2 body=$(head -c 120 /tmp/tg_socks.json 2>/dev/null || true)"
fi
# node undici/fetch-socks same as app
node - <<'NODE'
const path=require('path');
require('dotenv').config({path:path.join(__dirname,'.env')});
(async()=>{
  const {firstSocks5FromEnv}=require('./services/aiResponder');
  const s=firstSocks5FromEnv();
  console.log('node_socks', s&&{host:s.host,port:s.port,hasUser:!!s.userId});
  const token=process.env.NOTIFY_BOT_TOKEN||process.env.BOT_TOKEN;
  const url=`https://api.telegram.org/bot${token}/getMe`;
  try {
    const r=await fetch(url,{signal:AbortSignal.timeout(15000)});
    console.log('node_direct', r.status, (await r.text()).slice(0,80));
  } catch(e){ console.log('node_direct_err', e.message); }
  if(!s) return;
  try {
    const {socksDispatcher}=require('fetch-socks');
    const d=socksDispatcher({type:'socks5',host:s.host,port:Number(s.port),userId:s.userId,password:s.password});
    const r=await fetch(url,{dispatcher:d,signal:AbortSignal.timeout(20000)});
    console.log('node_socks_fetch', r.status, (await r.text()).slice(0,80));
  } catch(e){ console.log('node_socks_err', e.message); }
})().catch(e=>{console.error(e);process.exit(1)});
NODE
echo PROBE_OK
