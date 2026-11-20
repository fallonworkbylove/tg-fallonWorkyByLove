#!/bin/bash
# Ship LoveRussian updates from Mac → VPS (scp + remote _deploy_<tag>.sh).
# Usage:
#   bash scripts/mac-ship.sh                 # top CHANGELOG tag + auto files from _deploy_*.sh
#   bash scripts/mac-ship.sh 0m2             # tag — auto-collects SRC basenames from deploy script
#   bash scripts/mac-ship.sh 0m2 file1 …     # tag + extra files (still auto-collects)
#   MAC_SHIP_NO_AUTO=1 bash scripts/mac-ship.sh 0m2 file1  # only explicit files
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
    echo "No tag in CHANGELOG_TG.md — pass tag: bash scripts/mac-ship.sh 0m2"
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

ship_one() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    echo "Skip missing: $f"
    return 0
  fi
  local base
  base="$(basename "$f")"
  scp -q "$f" "${HOST}:${TMP}/${base}"
  echo "  + $f → ${TMP}/${base}"
}

# 0m2: parse `$SRC/name` from deploy script → local paths
if [[ "${MAC_SHIP_NO_AUTO:-}" != "1" ]]; then
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    case "$rel" in
      index_frontend.html|index_fe.html|index_ops.html|updates_fe.js|updates_ops.js|_deploy_*.sh|_deploy_guard.sh|CHANGELOG_TG.md)
        continue
        ;;
      _smoke_*|_hard_audit_*|_ultra_*|_deploy_*)
        ship_one "backend/scripts/${rel}"
        ;;
      mac-ship.sh|install-ssh-mac.sh|.gitignore)
        if [[ -f "scripts/${rel}" ]]; then
          ship_one "scripts/${rel}"
        elif [[ -f "${rel}" ]]; then
          ship_one "${rel}"
        else
          echo "Skip unresolved: $rel"
        fi
        ;;
      *.js)
        if [[ -f "backend/services/${rel}" ]]; then
          ship_one "backend/services/${rel}"
        elif [[ -f "backend/routes/${rel}" ]]; then
          ship_one "backend/routes/${rel}"
        elif [[ -f "frontend/${rel}" ]]; then
          ship_one "frontend/${rel}"
        elif [[ -f "backend/scripts/${rel}" ]]; then
          ship_one "backend/scripts/${rel}"
        elif [[ -f "scripts/${rel}" ]]; then
          ship_one "scripts/${rel}"
        else
          found=$(find backend frontend ops-console scripts -name "$rel" -type f 2>/dev/null | head -1 || true)
          if [[ -n "$found" ]]; then
            ship_one "$found"
          else
            echo "Skip unresolved: $rel"
          fi
        fi
        ;;
      *.css|*.html)
        if [[ -f "frontend/${rel}" ]]; then
          ship_one "frontend/${rel}"
        else
          found=$(find frontend ops-console -name "$rel" -type f 2>/dev/null | head -1 || true)
          [[ -n "$found" ]] && ship_one "$found" || echo "Skip unresolved: $rel"
        fi
        ;;
      *)
        found=$(find backend frontend ops-console scripts . -maxdepth 3 -name "$rel" -type f 2>/dev/null | head -1 || true)
        [[ -n "$found" ]] && ship_one "$found" || echo "Skip unresolved: $rel"
        ;;
    esac
  done < <(
    MAC_SHIP_DEPLOY_SH="$DEPLOY_SH" python3 - <<'PY'
import os, re
from pathlib import Path
text = Path(os.environ['MAC_SHIP_DEPLOY_SH']).read_text(encoding='utf-8', errors='ignore')
names = set()
for m in re.finditer(r'\$SRC/([A-Za-z0-9_.-]+)', text):
    names.add(m.group(1))
for m in re.finditer(r'"\$SRC"/([A-Za-z0-9_.-]+)', text):
    names.add(m.group(1))
for n in sorted(names):
    print(n)
PY
  )
fi

# Extra files from CLI — basename into /tmp/tag/
for f in "$@"; do
  ship_one "$f"
done

if [[ -n "${MAC_SHIP_EXTRA:-}" ]]; then
  # shellcheck disable=SC2086
  for f in $MAC_SHIP_EXTRA; do
    ship_one "$f"
  done
fi

ssh "$HOST" "sed -i 's/\r$//' '${TMP}/_deploy_${TAG}.sh' 2>/dev/null || true; bash '${TMP}/_deploy_${TAG}.sh' '${TMP}'"

echo "SHIP_OK tag=$TAG host=$HOST app=$BASE_REMOTE"
echo "Check: ssh $HOST 'pm2 status tgbot; bash $BASE_REMOTE/backend/scripts/_deploy_guard.sh'"
