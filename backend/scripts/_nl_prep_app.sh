#!/bin/bash
set -euo pipefail
mkdir -p /root/opt/tgbot /root/.ssh
chmod 700 /root/.ssh
# accept local pubkey if provided
if [ -f /tmp/nl_authorized_key.pub ]; then
  touch /root/.ssh/authorized_keys
  grep -qf /tmp/nl_authorized_key.pub /root/.ssh/authorized_keys || cat /tmp/nl_authorized_key.pub >> /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
  echo PUBKEY_INSTALLED
fi
# mysql db placeholder — real creds after dump
mysql -e "CREATE DATABASE IF NOT EXISTS telegram_ai_miniapp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
# app user — temporary random; will align with .env from old dump
PASS=$(openssl rand -hex 12)
mysql -e "CREATE USER IF NOT EXISTS 'tgbot'@'localhost' IDENTIFIED BY '$PASS';"
mysql -e "ALTER USER 'tgbot'@'localhost' IDENTIFIED BY '$PASS';"
mysql -e "GRANT ALL PRIVILEGES ON telegram_ai_miniapp.* TO 'tgbot'@'localhost'; FLUSH PRIVILEGES;"
echo "$PASS" > /root/.nl_mysql_tgbot_pass
chmod 600 /root/.nl_mysql_tgbot_pass
echo "MYSQL_PASS_SAVED"
echo "PREP_OK"
