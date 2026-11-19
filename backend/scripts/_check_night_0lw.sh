#!/bin/bash
date; date -u
cd /root/opt/tgbot/tg-miniapp-loverussian/backend || exit 1
node <<'NODE'
require('dotenv').config({ quiet: true });
const t = require('./services/timing');
const msk = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
console.log({
  msk,
  night: t.isNightTextQuietHour(),
});
NODE
grep -aE 'silence-heal|healed |очереди/Занята|night' /root/.pm2/logs/tgbot-out.log | tail -15
