#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "Waiting for apt lock..."
for i in $(seq 1 60); do
  if ! fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
    && ! fuser /var/lib/apt/lists/lock >/dev/null 2>&1 \
    && ! fuser /var/lib/dpkg/lock >/dev/null 2>&1; then
    echo "lock free after ${i}0s-ish try $i"
    break
  fi
  echo "busy try $i"
  sleep 10
done
# finish any interrupted dpkg
dpkg --configure -a || true
bash /tmp/_nl_bootstrap_02_install.sh
