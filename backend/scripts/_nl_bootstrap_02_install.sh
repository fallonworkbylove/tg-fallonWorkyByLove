#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "=== apt update ==="
apt-get update -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban git build-essential \
  nginx mysql-server certbot python3-certbot-nginx unzip rsync

# Node 20 via NodeSource
if ! command -v node >/dev/null 2>&1; then
  echo "=== install node 20 ==="
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

# pm2
npm install -g pm2

# swap 2G if missing
if ! swapon --show | grep -q .; then
  echo "=== swap 2G ==="
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# dirs
mkdir -p /root/opt/tgbot /root/logs /var/www/certbot

# firewall
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable || true

# mysql basic secure-ish: create db user later from dump
systemctl enable --now mysql nginx

echo "NODE=$(node -v)"
echo "NPM=$(npm -v)"
echo "PM2=$(pm2 -v)"
mysql --version
nginx -v
echo "BOOTSTRAP_INSTALL_OK"
