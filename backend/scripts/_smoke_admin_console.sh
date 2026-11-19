#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node <<'NODE'
require('dotenv').config();
const s = require('./services/adminConsoleStats');
s.getConsoleSnapshot()
  .then((x) => {
    console.log(
      JSON.stringify({
        day: x.messages.day.sent,
        week: x.messages.week.sent,
        month: x.messages.month.sent,
        total: x.accounts.total,
        online: x.accounts.online,
        ai: x.accounts.aiOn,
        hot: x.hotLeads,
      }),
    );
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
NODE
