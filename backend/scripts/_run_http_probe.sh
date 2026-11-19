#!/bin/bash
set -euo pipefail
sed -i 's/\r$//' /tmp/_probe_http_tg_now.js
node /tmp/_probe_http_tg_now.js
echo HTTP_PROBE_DONE
