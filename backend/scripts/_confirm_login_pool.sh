#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend || exit 1
echo "socks5=$(grep -c '^socks5' config/proxies-login.txt)"
echo "sticky=$(grep -c 'sessttl.60' config/proxies-login.txt)"
echo "first=$(head -1 config/proxies-login.txt | sed 's/:b4ea[^@]*@/:***@/')"
echo "last=$(tail -1 config/proxies-login.txt | sed 's/:b4ea[^@]*@/:***@/')"
grep -a 'Login (residential)' /root/.pm2/logs/tgbot-out.log | tail -1 | cut -c1-140
pm2 pid tgbot >/dev/null && echo tgbot=online || echo tgbot=down
