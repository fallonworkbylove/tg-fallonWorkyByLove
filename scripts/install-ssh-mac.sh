#!/bin/bash
# One-time: install VPS SSH key on this Mac (from repo secrets/ssh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY_SRC="$ROOT/secrets/ssh/id_ed25519"
PUB_SRC="$ROOT/secrets/ssh/id_ed25519.pub"

if [[ ! -f "$KEY_SRC" ]]; then
  echo "Missing $KEY_SRC — git pull first on branch with secrets/ssh"
  exit 1
fi

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
cp "$KEY_SRC" "$HOME/.ssh/id_ed25519"
cp "$PUB_SRC" "$HOME/.ssh/id_ed25519.pub"
chmod 600 "$HOME/.ssh/id_ed25519"
chmod 644 "$HOME/.ssh/id_ed25519.pub"

CFG="$HOME/.ssh/config"
MARKER="Host loverussian"
if [[ ! -f "$CFG" ]] || ! grep -q "^${MARKER}$" "$CFG" 2>/dev/null; then
  cat >> "$CFG" <<'EOF'

Host loverussian
  HostName loverussian.duckdns.org
  User root
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
EOF
  chmod 600 "$CFG"
  echo "Wrote Host loverussian → $CFG"
else
  echo "SSH config already has Host loverussian"
fi

ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes loverussian 'echo SSH_OK; hostname; whoami'
echo "Ready. Deploy: bash scripts/mac-ship.sh"
