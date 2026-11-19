#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$B"
CFG=config/proxies-login.txt
: "${LOGIN_PROXY_USER:?set LOGIN_PROXY_USER}"
: "${LOGIN_PROXY_PASS:?set LOGIN_PROXY_PASS}"
HOST=${LOGIN_PROXY_HOST:-46.4.139.124}
FROM=${LOGIN_PROXY_PORT_FROM:-10000}
TO=${LOGIN_PROXY_PORT_TO:-10049}
USER_STICKY="$LOGIN_PROXY_USER"
case "$USER_STICKY" in *__sessttl.*) ;; *) USER_STICKY="${USER_STICKY}__sessttl.60" ;; esac

cp -a "$CFG" "config/proxies-login.txt.bak.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
TMP=$(mktemp)
grep -E '^socks5' "$CFG" > "$TMP" 2>/dev/null || true
BEFORE=$(wc -l < "$TMP" | tr -d ' ')
for port in $(seq "$FROM" "$TO"); do
  echo "socks5://${USER_STICKY}:${LOGIN_PROXY_PASS}@${HOST}:${port}" >> "$TMP"
done
sort -u "$TMP" | grep -E '^socks5' > "${TMP}.u"
{
  echo "# login proxies — appended $(date -u +%Y-%m-%dT%H:%MZ)"
  cat "${TMP}.u"
} > "$CFG"
AFTER=$(grep -c '^socks5' "$CFG" || true)
rm -f "$TMP" "${TMP}.u"
echo "before=$BEFORE after=$AFTER"
