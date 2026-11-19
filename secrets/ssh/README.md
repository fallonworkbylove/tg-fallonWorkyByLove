# SSH key for VPS (Mac)

Host: root@loverussian.duckdns.org
Key that VPS accepts: id_ed25519

## Install on Mac
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cp secrets/ssh/id_ed25519 ~/.ssh/id_ed25519
cp secrets/ssh/id_ed25519.pub ~/.ssh/id_ed25519.pub
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub
ssh -o StrictHostKeyChecking=accept-new root@loverussian.duckdns.org

Optional ~/.ssh/config:
Host loverussian
  HostName loverussian.duckdns.org
  User root
  IdentityFile ~/.ssh/id_ed25519
