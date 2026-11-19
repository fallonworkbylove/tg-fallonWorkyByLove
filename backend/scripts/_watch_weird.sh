#!/bin/bash
OUT=/root/.pm2/logs/tgbot-out.log
echo '=== soft / weird replies ==='
grep 'Ответ для' "$OUT" | tail -n 500 | grep -iE 'быстрее.*поезд|поезд.*быстрее|в Москва[^е]|в Анапа[^у]|робот|нейросет|chatgpt|как ии|я ии|флиппинг|токенов|часа четыре|20-24|завтра.*поезд|поезд.*завтра' | tail -40
echo '=== media/leak ==='
tail -n 1000 "$OUT" | grep -iE 'ты отправила|Ответ для.*\[медиа|stripLeaked' | tail -20
echo '=== auth/session ==='
tail -n 1000 "$OUT" | grep -iE 'AUTH_KEY|отозвана|сессия пуста|Нужна авторизация|не стираю' | tail -20
echo '=== last 15 replies ==='
grep 'Ответ для' "$OUT" | tail -15
