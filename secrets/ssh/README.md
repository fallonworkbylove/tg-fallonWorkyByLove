# SSH key for VPS (Mac)

Host: `root@loverussian.duckdns.org` (alias `loverussian`)  
Key: `id_ed25519`

## One-time install

```bash
bash scripts/install-ssh-mac.sh
```

Full guide: [docs/MAC_DEPLOY.md](../../docs/MAC_DEPLOY.md)

## Ship updates

```bash
bash scripts/mac-ship.sh 0m1
bash scripts/mac-ship.sh 0m1 backend/services/opsQuality.js
```
