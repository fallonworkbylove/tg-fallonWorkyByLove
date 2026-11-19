#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
python3 - <<'PY' > /tmp/_export_pl.sh
import json, shlex
from subprocess import check_output
j=json.loads(check_output(["pm2","jlist"], text=True))
p=[x for x in j if x["name"]=="tgbot"][0]
pl=p["pm2_env"].get("PROXY_LIST") or ""
print("pm2_PROXY_LEN", len([x for x in pl.split(";") if x.strip()]), file=__import__("sys").stderr)
print("export PROXY_LIST="+shlex.quote(pl))
PY
# shellcheck disable=SC1091
source /tmp/_export_pl.sh
node scripts/_probe_proxy_tg_vs_any.js | tee /tmp/pool32_probe.out
echo "--- SUMMARY ---"
echo "TG_OK $(grep -c '^TG_OK' /tmp/pool32_probe.out || true)"
echo "TG_FAIL_BUT_ALIVE $(grep -c '^TG_FAIL_BUT_ALIVE' /tmp/pool32_probe.out || true)"
echo "DEAD $(grep -c '^DEAD' /tmp/pool32_probe.out || true)"
