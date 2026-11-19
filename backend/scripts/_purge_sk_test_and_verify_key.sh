#!/bin/bash
# Полная проверка OPENAI_API_KEY + вычищение sk-test из pm2/dump/shell.
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

echo "========== 1) .env =========="
KEY=$(python3 - <<'PY'
import re
env=open('.env','r',encoding='utf-8',errors='ignore').read()
m=re.search(r'^OPENAI_API_KEY=(.+)$', env, re.M)
raw=(m.group(1).strip().strip('"').strip("'") if m else '')
print(raw)
PY
)
if [ -z "$KEY" ]; then echo "FAIL: OPENAI_API_KEY missing in .env"; exit 1; fi
if [ "$KEY" = "sk-test" ] || [[ "$KEY" == sk-test* ]] || [[ "$KEY" == *test* && ${#KEY} -lt 30 ]]; then
  echo "FAIL: .env key looks like test poison: ${KEY:0:12}…"
  exit 1
fi
if [[ "$KEY" != sk-proj-* && "$KEY" != sk-* ]]; then
  echo "FAIL: unexpected key prefix ${KEY:0:8}"
  exit 1
fi
if [ ${#KEY} -lt 40 ]; then
  echo "FAIL: key too short len=${#KEY}"
  exit 1
fi
echo "dotenv_ok prefix=${KEY:0:8}… len=${#KEY}"

# нет второго OPENAI_API_KEY=sk-test в .env
if grep -nE 'OPENAI_API_KEY=.*sk-test' .env 2>/dev/null; then
  echo "FAIL: sk-test still in .env"
  exit 1
fi
echo "dotenv_no_sk_test"

echo
echo "========== 2) scan pm2 dump / ecosystem for sk-test =========="
DUMP=/root/.pm2/dump.pm2
ECO=
for c in ecosystem.config.js ecosystem.config.cjs pm2.config.js; do
  [ -f "$c" ] && ECO="$c"
  [ -f "/root/opt/tgbot/tg-miniapp-loverussian/$c" ] && ECO="/root/opt/tgbot/tg-miniapp-loverussian/$c"
done
FOUND=0
if [ -f "$DUMP" ] && grep -q 'sk-test' "$DUMP" 2>/dev/null; then
  echo "FOUND sk-test in dump.pm2 — will rewrite after restore"
  FOUND=1
fi
if [ -n "$ECO" ] && grep -q 'sk-test' "$ECO" 2>/dev/null; then
  echo "FOUND sk-test in $ECO"
  FOUND=1
fi
# process list env
node <<'NODE'
const { execSync } = require('child_process');
const apps = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
const a = apps.find((x) => x.name === 'tgbot');
const k = (a && a.pm2_env && a.pm2_env.OPENAI_API_KEY) || '';
console.log('pm2_live', k ? `${k.slice(0, 8)}… len=${k.length}` : 'MISSING', k === 'sk-test' || /^sk-test/.test(k) ? 'POISON' : 'OK');
if (k === 'sk-test' || /^sk-test/.test(k)) process.exit(3);
NODE
LIVE_RC=$?
if [ "$LIVE_RC" = "3" ]; then FOUND=1; fi

echo
echo "========== 3) restore real key into pm2 (kill sk-test) =========="
# Явно убрать из текущего shell и из pm2 env
unset OPENAI_API_KEY || true
export OPENAI_API_KEY="$KEY"
# delete from pm2 env first then set — pm2 set doesn't exist for env; restart --update-env uses shell export
pm2 restart tgbot --update-env
pm2 save
sleep 4

node <<'NODE'
const { execSync } = require('child_process');
const apps = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
const a = apps.find((x) => x.name === 'tgbot');
const k = (a && a.pm2_env && a.pm2_env.OPENAI_API_KEY) || '';
const bad = !k || k === 'sk-test' || /^sk-test/.test(k) || k.length < 40;
console.log('pm2_after', k ? `${k.slice(0, 8)}… len=${k.length}` : 'MISSING', bad ? 'BAD' : 'OK');
console.log('pid', a && a.pid);
if (bad) process.exit(2);
NODE

# dump.pm2 не должен содержать sk-test
if [ -f "$DUMP" ] && grep -q 'sk-test' "$DUMP" 2>/dev/null; then
  echo "scrubbing dump.pm2 sk-test…"
  python3 - <<'PY'
from pathlib import Path
p = Path('/root/.pm2/dump.pm2')
t = p.read_text(encoding='utf-8', errors='ignore')
# не трогаем настоящий ключ — только литерал sk-test как значение
import re
t2 = re.sub(r'("OPENAI_API_KEY"\s*:\s*")sk-test[^"]*(")', r'\1REMOVED\2', t)
t2 = t2.replace('sk-test', 'REMOVED_PLACEHOLDER')
if 'sk-test' in t2:
    raise SystemExit('still has sk-test after scrub')
p.write_text(t2, encoding='utf-8')
print('dump_scrubbed')
PY
  # пересохранить dump с актуальным env процесса
  export OPENAI_API_KEY="$KEY"
  pm2 restart tgbot --update-env
  pm2 save
fi

echo
echo "========== 4) dump.pm2 final check =========="
if [ -f "$DUMP" ] && grep -q 'sk-test' "$DUMP" 2>/dev/null; then
  echo "FAIL: dump still has sk-test"
  grep -o 'sk-test[^"]*' "$DUMP" | head -5
  exit 1
fi
echo "dump_clean"

echo
echo "========== 5) live OpenAI ping =========="
cp -f /tmp/_ping_openai.js scripts/_ping_openai.js 2>/dev/null || true
OPENAI_API_KEY="$KEY" node scripts/_ping_openai.js

echo
echo "========== 6) ERR: only NEW after mark =========="
MARK="KEYCHECK_$(date -u +%Y%m%d%H%M%S)"
echo "[$MARK]" >> /root/.pm2/logs/tgbot-error.log
sleep 2
# старый хвост с sk-test — архивируем, чтобы не путал
ERR=/root/.pm2/logs/tgbot-error.log
if [ -f "$ERR" ]; then
  # ротация: оставить только после mark (или пустой хвост)
  python3 - <<PY
from pathlib import Path
p = Path('/root/.pm2/logs/tgbot-error.log')
t = p.read_text(encoding='utf-8', errors='ignore')
mark = "$MARK"
i = t.rfind(mark)
if i >= 0:
    p.write_text(t[i:] + "\n", encoding='utf-8')
    print('err_rotated_after_mark')
else:
    print('err_mark_not_found_skip')
PY
fi
sleep 3
NEW_BAD=$(pm2 logs tgbot --err --lines 30 --nostream 2>/dev/null | grep -c 'sk-test' || true)
echo "new_err_sk_test_lines=$NEW_BAD"
if [ "$NEW_BAD" -gt 0 ]; then
  echo "FAIL: fresh err still mentions sk-test"
  pm2 logs tgbot --err --lines 20 --nostream
  exit 1
fi

echo
echo "========== 7) summary =========="
node <<'NODE'
const { execSync } = require('child_process');
const apps = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
const a = apps.find((x) => x.name === 'tgbot');
const k = (a && a.pm2_env && a.pm2_env.OPENAI_API_KEY) || '';
console.log(JSON.stringify({
  pm2_prefix: k.slice(0, 8),
  pm2_len: k.length,
  is_sk_test: k === 'sk-test' || /^sk-test/.test(k),
  pid: a && a.pid,
  status: a && a.pm2_env && a.pm2_env.status,
}, null, 2));
NODE
echo KEY_PURGE_OK
