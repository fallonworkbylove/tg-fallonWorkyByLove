#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
ERR=/root/.pm2/logs/tgbot-error.log
DUMP=/root/.pm2/dump.pm2

# ротация ERR: убрать старые sk-test 401
python3 <<'PY'
from pathlib import Path
p = Path('/root/.pm2/logs/tgbot-error.log')
if p.exists():
    # backup once
    bak = Path('/root/.pm2/logs/tgbot-error.log.pre-keypurge.bak')
    if not bak.exists():
        bak.write_bytes(p.read_bytes())
    # keep only last 50 lines that are NOT sk-test poisoned history
    lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
    keep = [ln for ln in lines[-80:] if 'sk-test' not in ln]
    keep.append('[KEYPURGE] err cleaned of sk-test history')
    p.write_text('\n'.join(keep) + '\n', encoding='utf-8')
    print('err_cleaned', 'kept', len(keep))
else:
    print('err_missing')
PY

echo "--- counts ---"
echo -n "dump sk-test: "; grep -c sk-test "$DUMP" 2>/dev/null || echo 0
echo -n "err sk-test: "; grep -c sk-test "$ERR" 2>/dev/null || echo 0
echo -n ".env sk-test: "; grep -c sk-test .env 2>/dev/null || echo 0

node <<'NODE'
const { execSync } = require('child_process');
const apps = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
const a = apps.find((x) => x.name === 'tgbot');
const k = (a && a.pm2_env && a.pm2_env.OPENAI_API_KEY) || '';
const bad = !k || k === 'sk-test' || /^sk-test/.test(k) || k.length < 40;
console.log(JSON.stringify({
  prefix: k.slice(0, 8),
  len: k.length,
  is_sk_test: k === 'sk-test' || /^sk-test/.test(k),
  pid: a && a.pid,
  status: a && a.pm2_env && a.pm2_env.status,
  ok: !bad,
}, null, 2));
if (bad) process.exit(2);
NODE

# quick ping without hanging on pm2 logs
OPENAI_API_KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')") \
  node scripts/_ping_openai.js

echo KEY_FINISH_OK
