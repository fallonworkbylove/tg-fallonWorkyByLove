#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
B="$ROOT/backend"
F="$ROOT/frontend"
ENV="$B/.env"

cp -f /tmp/telegramAuth.js "$B/middleware/"
cp -f /tmp/adminConsole.js "$B/routes/"
cp -f /tmp/adminConsoleStats.js "$B/services/"
cp -f /tmp/dashboard.js "$B/routes/"
cp -f /tmp/server.js "$B/"
cp -f /tmp/app.js /tmp/styles.css /tmp/index.html /tmp/updates.js "$F/"

if ! grep -q '^ADMIN_CONSOLE_TOKEN=' "$ENV" 2>/dev/null; then
  TOK=$(openssl rand -hex 24)
  printf '\nADMIN_CONSOLE_TOKEN=%s\n' "$TOK" >> "$ENV"
else
  TOK=$(python3 -c "import re;m=re.search(r'^ADMIN_CONSOLE_TOKEN=(.+)$',open('$ENV',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
  if [ -z "$TOK" ] || [ "${#TOK}" -lt 16 ]; then
    TOK=$(openssl rand -hex 24)
    sed -i '/^ADMIN_CONSOLE_TOKEN=/d' "$ENV"
    printf 'ADMIN_CONSOLE_TOKEN=%s\n' "$TOK" >> "$ENV"
  fi
fi
echo "GENERATED_TOKEN=$TOK"

cd "$B"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
export ADMIN_CONSOLE_TOKEN="$TOK"

timeout 50 pm2 restart tgbot --update-env
pm2 save
sleep 4

node <<'NODE'
require('dotenv').config();
const tok = process.env.ADMIN_CONSOLE_TOKEN;
if (!tok || tok.length < 16) {
  console.error('no token in env');
  process.exit(1);
}
const http = require('http');
http
  .get(
    {
      hostname: '127.0.0.1',
      port: Number(process.env.PORT || 3000),
      path: '/api/admin/console',
      headers: { 'X-Admin-Console-Token': tok, Accept: 'application/json' },
      timeout: 20000,
    },
    (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.error('smoke_fail', res.statusCode, b.slice(0, 240));
          process.exit(1);
        }
        const j = JSON.parse(b);
        console.log(
          'smoke_ok',
          j.console.messages.day.sent,
          j.console.accounts.total,
          j.console.accounts.online,
        );
        console.log('DEPLOY_OK');
      });
    },
  )
  .on('error', (e) => {
    console.error(e);
    process.exit(1);
  });
NODE

echo "pid=$(pm2 pid tgbot)"
grep -n 'adminConsoleAuth\|Админ-консоль на компьютере\|updates.js?v=71\|app.js?v=63' \
  "$B/middleware/telegramAuth.js" "$F/updates.js" "$F/index.html" | head -12
