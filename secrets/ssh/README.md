# SSH key for VPS (Mac)

Host: `root@loverussian.duckdns.org` (alias `loverussian`)

## Security

**Private key `id_ed25519` is NOT in git** (see `.gitignore`).  
Keep it only in `~/.ssh/` on machines that deploy, or drop a local copy into `secrets/ssh/` (untracked) before `install-ssh-mac.sh`.

Public key `id_ed25519.pub` may stay in the repo for reference.

## One-time install

```bash
# if you have a local untracked key:
bash scripts/install-ssh-mac.sh

# or copy existing key:
# cp ~/.ssh/id_ed25519 secrets/ssh/   # local only, never commit
# bash scripts/install-ssh-mac.sh
```

Full guide: [docs/MAC_DEPLOY.md](../../docs/MAC_DEPLOY.md)

## Ship updates

```bash
bash scripts/mac-ship.sh          # top CHANGELOG tag, auto files from _deploy_*.sh
bash scripts/mac-ship.sh 0m2
bash scripts/mac-ship.sh 0m2 backend/services/opsQuality.js
```
