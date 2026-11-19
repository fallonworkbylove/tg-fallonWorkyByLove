#!/bin/bash
set -euo pipefail
grep -a 'Warm TG' /root/.pm2/logs/tgbot-out.log | tail -5
grep -a 'Work (DC) пул' /root/.pm2/logs/tgbot-out.log | tail -2
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];pl=p["pm2_env"].get("PROXY_LIST")or"";print({"proxy":len([x for x in pl.split(";")if x.strip()]),"status":p["pm2_env"]["status"]})'
grep -a 'Ответ для' /root/.pm2/logs/tgbot-out.log | tail -3
grep -a 'Восстановление сессий завершено' /root/.pm2/logs/tgbot-out.log | tail -1
