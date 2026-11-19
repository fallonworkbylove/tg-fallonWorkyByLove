#!/bin/bash
grep -aE 'QR старт|qr: ок|Connect QR|Готовлю QR|qrImage|sendPhoto|Connect QR start|код для|SMS' /root/.pm2/logs/tgbot-out.log | tail -30
echo '==== ERR ===='
grep -aE 'QR|login|код' /root/.pm2/logs/tgbot-error.log | tail -20
echo '==== LIVE ===='
tail -n 25 /root/.pm2/logs/tgbot-out.log | grep -aE 'login|QR|Ответ для|Warm|silence' || tail -n 15 /root/.pm2/logs/tgbot-out.log
