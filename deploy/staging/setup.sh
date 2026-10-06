#!/bin/bash
# One-time setup of the staging server (Amazon Linux 2023, t3.micro).
# Passed as EC2 user data, so it runs as root on first boot. Log: /var/log/swasthya-setup.log
set -euxo pipefail
exec > >(tee -a /var/log/swasthya-setup.log) 2>&1
REPO=${REPO:-https://github.com/vivekanand49/find.git}

# 1 GB of memory is not enough to build the app: add 2 GB of swap.
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048 && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
fi

dnf install -y docker git
mkdir -p /usr/local/lib/docker/cli-plugins
ARCH=$(uname -m)
curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-$ARCH" -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
systemctl enable --now docker

[ -d /opt/swasthya ] || git clone "$REPO" /opt/swasthya

# Secrets are made here and never leave the server.
mkdir -p /opt/swasthya-secrets && chmod 700 /opt/swasthya-secrets
if [ ! -f /opt/swasthya/.env.production ]; then
  openssl rand -hex 24 > /opt/swasthya-secrets/postgres_password
  cat > /opt/swasthya/.env.production <<ENV
NODE_ENV=production
JWT_SECRET=$(openssl rand -hex 32)
ID_HASH_SECRET=$(openssl rand -hex 32)
GATEWAY_SECRET=$(openssl rand -hex 32)
SMS_PROVIDER=console
ENV
  chmod 600 /opt/swasthya/.env.production
fi

cat > /etc/systemd/system/swasthya.service <<UNIT
[Unit]
Description=Swasthya Setu staging
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash /opt/swasthya/deploy/staging/start.sh

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now swasthya.service
