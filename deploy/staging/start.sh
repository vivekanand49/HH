#!/bin/bash
# Starts (or updates) staging. Runs at every boot: the public IP can change
# after a stop/start, so the sslip.io name is worked out again each time.
set -euo pipefail
cd /opt/swasthya
TOKEN=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
export DOMAIN="${IP//./-}.sslip.io"
export POSTGRES_PASSWORD=$(cat /opt/swasthya-secrets/postgres_password)
echo "Staging at https://$DOMAIN"
docker compose -f docker-compose.yml -f deploy/staging/docker-compose.staging.yml up -d --build --remove-orphans
