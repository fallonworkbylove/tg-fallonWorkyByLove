#!/bin/bash
# Restore real OPENAI_API_KEY into pm2 after deploy polluted with sk-deploy
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend"

echo "=== before ==="
pm2 env 0 2>/dev/null | grep -E '^OPENAI_API_KEY' | head -1 | sed 's/=.*/=***/' || true
node -e '
const {execSync}=require("child_process");
const d=JSON.parse(execSync("pm2 jlist",{encoding:"utf8"}));
const e=d.find(x=>x.name==="tgbot").pm2_env;
const k=String(e.OPENAI_API_KEY||"");
console.log("pm2_key_prefix", k.slice(0,12), "len", k.length, "is_deploy", k==="sk-deploy"||k.startsWith("sk-deploy")||k.startsWith("sk-audit")||k.startsWith("sk-a")||k.startsWith("sk-test"));
'

# Real key from .env only
REAL=$(grep -E '^OPENAI_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')
if [ -z "$REAL" ] || [ "$REAL" = "sk-deploy" ] || [[ "$REAL" == sk-audit* ]] || [[ "$REAL" == sk-test* ]]; then
  echo "REFUSE: .env OPENAI_API_KEY missing or fake"
  exit 1
fi
echo "env_key_prefix ${REAL:0:12} len ${#REAL}"

# Clear polluted shell export, restart from dump+.env via ecosystem or env update
# pm2 --update-env reads current shell; inject real key only
export OPENAI_API_KEY="$REAL"
# Also drop AUDIT_SMOKE if present
unset AUDIT_SMOKE || true

pm2 restart tgbot --update-env
pm2 save
sleep 5

node -e '
const {execSync}=require("child_process");
const d=JSON.parse(execSync("pm2 jlist",{encoding:"utf8"}));
const e=d.find(x=>x.name==="tgbot").pm2_env;
const k=String(e.OPENAI_API_KEY||"");
const pl=String(e.PROXY_LIST||"").split(";").filter(Boolean);
console.log("after_prefix", k.slice(0,12), "len", k.length, "fake", /^(sk-deploy|sk-audit|sk-test|sk-a$)/.test(k), "PROXY", pl.length, "status", e.status);
if(!k || k==="sk-deploy" || k.startsWith("sk-deploy") || k.startsWith("sk-audit") || k.startsWith("sk-test")) process.exit(2);
if(e.status!=="online"||pl.length<5) process.exit(3);
'

# Quick OpenAI ping via app health / openai ready
curl -sS -m 10 http://127.0.0.1:3000/api/health
echo
bash scripts/_deploy_guard.sh || true

echo "=== wait errors (8s) ==="
sleep 8
grep -aE 'sk-deploy|Incorrect API key' /root/.pm2/logs/tgbot-error.log | tail -5 || echo no_recent_sk_deploy_in_tail
# fresh errors after restart
ERR_TS=$(date -u +%H:%M)
grep -aE 'Incorrect API key|sk-deploy' /root/.pm2/logs/tgbot-error.log | tail -3
# Check if NEW errors after restart still say sk-deploy (compare file mtime lines - use last 15 lines only)
echo "--- last 15 error lines ---"
tail -15 /root/.pm2/logs/tgbot-error.log

echo FIX_OPENAI_KEY_0lr_OK
