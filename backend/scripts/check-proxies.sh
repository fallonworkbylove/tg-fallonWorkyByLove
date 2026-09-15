#!/usr/bin/env bash
#
# Массовая проверка списка прокси через curl (SOCKS5) с обращением к
# api.telegram.org. Живым считается прокси, до которого удалось установить
# TCP-соединение и получить любой HTTP-ответ (даже 4xx от Telegram — это
# нормально, значит сеть работает).
#
# Использование:
#   ./check-proxies.sh proxies_raw.txt
#
# Входной файл — одна запись на строку, поддерживаются оба формата:
#   213.232.122.175:1080@NLPELQ93D:sir8srCj      (ip:port@user:pass)
#   socks5:213.232.122.175:1080:NLPELQ93D:sir8srCj (формат PROXY_LIST/proxies.txt)
# Пустые строки и строки, начинающиеся с "#", пропускаются.
#
# Результат печатается в консоль и сохраняется в:
#   alive_proxies.txt — рабочие, уже в формате socks5:ip:port:user:pass
#                        (готовы к копипасте в backend/config/proxies.txt)
#   dead_proxies.txt   — неотвечающие/сломанные

set -u

INPUT_FILE="${1:-}"
if [ -z "$INPUT_FILE" ] || [ ! -f "$INPUT_FILE" ]; then
  echo "Использование: $0 <файл_со_списком_прокси>"
  exit 1
fi

CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-8}"
TEST_URL="${TEST_URL:-https://api.telegram.org}"

ALIVE_FILE="alive_proxies.txt"
DEAD_FILE="dead_proxies.txt"
> "$ALIVE_FILE"
> "$DEAD_FILE"

total=0
alive=0

while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  line="$(echo "$raw_line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [ -z "$line" ] && continue
  case "$line" in \#*) continue ;; esac

  total=$((total + 1))

  # Разбираем оба поддерживаемых формата в единый ip:port и user:pass.
  if echo "$line" | grep -q '@'; then
    ip_port="${line%%@*}"
    cred="${line##*@}"
    user="${cred%%:*}"
    pass="${cred##*:}"
  else
    # socks5:IP:PORT:USER:PASS  или  socks5:IP:PORT
    IFS=':' read -r _scheme ip port user pass <<< "$line"
    ip_port="${ip}:${port}"
  fi

  if [ -n "${user:-}" ] && [ -n "${pass:-}" ]; then
    auth="${user}:${pass}@"
  else
    auth=""
  fi

  http_code=$(curl -x "socks5://${auth}${ip_port}" "$TEST_URL" \
    -s -o /dev/null -w "%{http_code}" --connect-timeout "$CONNECT_TIMEOUT" 2>/dev/null)

  if [ -n "$http_code" ] && [ "$http_code" != "000" ]; then
    alive=$((alive + 1))
    echo "OK   $line  (HTTP $http_code)"
    if [ -n "${user:-}" ] && [ -n "${pass:-}" ]; then
      echo "socks5:${ip_port}:${user}:${pass}" >> "$ALIVE_FILE"
    else
      echo "socks5:${ip_port}" >> "$ALIVE_FILE"
    fi
  else
    echo "DEAD $line"
    echo "$line" >> "$DEAD_FILE"
  fi
done < "$INPUT_FILE"

echo ""
echo "Готово: живых $alive из $total."
echo "Рабочие (в формате для proxies.txt) -> $ALIVE_FILE"
echo "Мёртвые -> $DEAD_FILE"
