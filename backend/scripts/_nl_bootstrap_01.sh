#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "=== OS ==="
. /etc/os-release
echo "$PRETTY_NAME"
uname -a
echo "=== NET PROBE ==="
curl -sS -o /dev/null -w "tg_api:%{http_code} t=%{time_total}\n" --connect-timeout 12 https://api.telegram.org/ || echo TG_FAIL
curl -sS -o /dev/null -w "google:%{http_code}\n" --connect-timeout 8 https://www.google.com/ || echo GOOGLE_FAIL
curl -sS -o /dev/null -w "openai:%{http_code}\n" --connect-timeout 10 https://api.openai.com/v1/models || echo OPENAI_FAIL
# MTProto DC direct
timeout 8 bash -c 'echo >/dev/tcp/149.154.167.51/443' && echo DC51_OK || echo DC51_FAIL
timeout 8 bash -c 'echo >/dev/tcp/149.154.175.54/443' && echo DC54_OK || echo DC54_FAIL
echo "=== INSTALLED? ==="
command -v node || true
command -v mysql || true
command -v nginx || true
command -v pm2 || true
echo "BOOTSTRAP_PROBE_OK"
