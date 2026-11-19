#!/bin/bash
# Ship LoveRussian updates from Mac → VPS (scp + remote _deploy_<tag>.sh).
# Usage:
#   bash scripts/mac-ship.sh                 # interactive: next tag from CHANGELOG + changed files
#   bash scripts/mac-ship.sh 0m1             # tag only — expects backend/scripts/_deploy_0m1.sh
#   bash scripts/mac-ship.sh 0m1 file1 file2 # tag + extra files to /tmp/<tag>/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
HOST="${LOVERUSSIAN_SSH_HOST:-loverussian}"
BASE_REMOTE="/root/opt/tgbot/tg-miniapp-loverussian"

if ! ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" 'echo ok' >/dev/null 2>&1; then
  echo "SSH fail to $HOST. Run: bash scripts/install-ssh-mac.sh"
  exit 1
fi

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  TAG=$(python3 - <<'PY'
import re
from pathlib import Path
cl = Path('CHANGELOG_TG.md').read_text(encoding='utf-8', errors='ignore')
m = re.search(r'^## (0[a-z0-9]+)\.', cl, re.M)
print(m.group(1) if m else '')
PY
)
  if [[ -z "$TAG" ]]; then
    echo "No tag in CHANGELOG_TG.md — pass tag: bash scripts/mac-ship.sh 0m1"
    exit 1
  fi
  echo "Using top CHANGELOG tag: $TAG"
  shift || true
else
  shift
fi

DEPLOY_SH="backend/scripts/_deploy_${TAG}.sh"
if [[ ! -f "$DEPLOY_SH" ]]; then
  echo "Missing $DEPLOY_SH — create deploy script for this tag first (or ask Cursor «выкати $TAG»)."
  exit 1
fi

TMP="/tmp/${TAG}"
ssh "$HOST" "mkdir -p '$TMP'"

# Always ship the deploy script + dual FE/OPS indexes under distinct names (no scp clash)
scp -q "$DEPLOY_SH" "${HOST}:${TMP}/_deploy_${TAG}.sh"
if [[ -f frontend/index.html ]]; then
  scp -q frontend/index.html "${HOST}:${TMP}/index_frontend.html"
  scp -q frontend/index.html "${HOST}:${TMP}/index_fe.html"
fi
if [[ -f ops-console/app/index.html ]]; then
  scp -q ops-console/app/index.html "${HOST}:${TMP}/index_ops.html"
fi
if [[ -f frontend/updates.js ]]; then
  scp -q frontend/updates.js "${HOST}:${TMP}/updates_fe.js"
fi
if [[ -f ops-console/app/updates.js ]]; then
  scp -q ops-console/app/updates.js "${HOST}:${TMP}/updates_ops.js"
fi
if [[ -f CHANGELOG_TG.md ]]; then
  scp -q CHANGELOG_TG.md "${HOST}:${TMP}/CHANGELOG_TG.md"
fi
if [[ -f backend/scripts/_deploy_guard.sh ]]; then
  scp -q backend/scripts/_deploy_guard.sh "${HOST}:${TMP}/_deploy_guard.sh"
fi

# Extra files from CLI — basename into /tmp/tag/
for f in "$@"; do
  if [[ ! -f "$f" ]]; then
    echo "Skip missing: $f"
    continue
  fi
  base="$(basename "$f")"
  scp -q "$f" "${HOST}:${TMP}/${base}"
  echo "  + $f → ${TMP}/${base}"
done

# Common service/script names if present as args were empty — optional bulk of dirty paths via env
if [[ -n "${MAC_SHIP_EXTRA:-}" ]]; then
  # shellcheck disable=SC2086
  for f in $MAC_SHIP_EXTRA; do
    [[ -f "$f" ]] || continue
    scp -q "$f" "${HOST}:${TMP}/$(basename "$f")"
  done
fi

ssh "$HOST" "sed -i 's/\r$//' '${TMP}/_deploy_${TAG}.sh' 2>/dev/null || true; bash '${TMP}/_deploy_${TAG}.sh' '${TMP}'"

echo "SHIP_OK tag=$TAG host=$HOST app=$BASE_REMOTE"
echo "Check: ssh $HOST 'pm2 status tgbot; bash $BASE_REMOTE/backend/scripts/_deploy_guard.sh'"
