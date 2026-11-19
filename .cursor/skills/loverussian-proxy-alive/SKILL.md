---
name: loverussian-proxy-alive
description: >-
  Keep LoveRussian tgbot PROXY_LIST alive (≥5 socks5) on VPS after pm2 restart
  or deploy. Use when user mentions proxy, PROXY_LIST, REFUSE_PROXY, socks,
  прокси сдохли, OpenAI via proxy, or after any tgbot restart/deploy.
---

# LoveRussian proxy alive

## Hard rule
After **every** `pm2 restart tgbot --update-env` / deploy: **PROXY_LEN ≥ 5**.
If count < 5 → **refuse** go-live; restore alive list first.

## Dead re-probe (0gu+)
Cron twice daily (UTC `0 4,16` = **07:00 / 19:00 MSK**):
`backend/scripts/_reprobe_dead_proxies.sh` → reads `config/proxies-dead.txt`.
- TG again → `proxies-tg-ok.txt` + `PROXY_LIST` + pm2 restart
- OpenAI/HTTPS only → `proxies-openai-ok.txt` + `OPENAI_PROXY_LIST`
- still dead → stay in dead notebook
Log: `/root/logs/proxy-dead-reprobe.log`

## Host
- SSH: `root@loverussian.duckdns.org`
- App: `/root/opt/tgbot/tg-miniapp-loverussian`
- Env: `backend/.env` key `PROXY_LIST` (semicolon-separated `socks5:host:port:user:pass`)
- PM2 process: `tgbot` — must see same list in `pm2_env.PROXY_LIST`

## Check

```bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
# .env length
python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
pl=(m.group(1).strip() if m else '')
print('env_PROXY_LEN', len([x for x in pl.split(';') if x.strip()]))
PY
# pm2 length
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()])})'
```

Also glance error log:

```bash
grep -aE 'REFUSE_PROXY|SocksClientError|proxy|ECONNREFUSED|OPENAI' /root/.pm2/logs/tgbot-error.log | tail -20
```

## Failover (0gm+)
`proxyPools.markProxyDead` — на timeout/SocksClient сразу skip ~12м и переключение на следующий.
GramJS: `clientPool` зовёт mark на fail. OpenAI: `openaiCreateWithProxyFailover`.

## Restore
1. Prefer last known good pool from `_force_alive_proxy_pm2.sh` / `_deploy_0gm.sh` (17 DC: QbQaXK / BfNHVZ / nFBMNd / SJe5Co).
2. Write `PROXY_LIST=...` into `backend/.env` (replace line, do not append duplicates).
3. Keep `proxies.txt` empty (env-only pool — avoid double).
4. Export into shell → `pm2 restart tgbot --update-env` → `pm2 save`.
5. Re-check **pm2_PROXY_LEN ≥ 5**.

Helper on VPS (if present):

```bash
bash /root/opt/tgbot/tg-miniapp-loverussian/backend/scripts/_force_alive_proxy_pm2.sh
# or copy from repo: backend/scripts/_force_alive_proxy_pm2.sh / _fix_pm2_proxy_list.sh
```

Optional probe:

```bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend && node scripts/_probe_openai_proxies.js
```

## Deploy scripts
Any `_deploy_0gX.sh` must:
- embed alive `ALIVE='socks5:…;…'` (≥5)
- patch `.env` before restart
- `echo PROXY_LEN=…` and `[ "$n" -ge 5 ] || exit 1`
- after `pm2 restart`: run `bash backend/scripts/_deploy_guard.sh` (PROXY + `openai_ready` + no `AUDIT_SMOKE`)

## Do not
- Restart with empty / 1–2 proxies «потом поправим»
- Commit real proxy passwords into git chats beyond existing deploy scripts pattern
- Merge dead hosts back into the alive string without a probe
