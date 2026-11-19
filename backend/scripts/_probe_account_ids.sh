#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
set -a
# shellcheck disable=SC1091
source .env
set +a
mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "SELECT id, phone FROM accounts ORDER BY id;"
mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DB_NAME' AND COLUMN_NAME IN ('account_id','telegram_account_id','photo_reader_account_id') ORDER BY TABLE_NAME;"
