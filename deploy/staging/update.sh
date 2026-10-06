#!/bin/bash
# Pulls new code from GitHub and redeploys, but only when something changed.
# Run every 5 minutes by swasthya-update.timer (see install-auto-update.sh).
set -euo pipefail
cd /opt/swasthya
git fetch -q origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "Updating $(git rev-parse --short HEAD) -> $(git rev-parse --short origin/main)"
  # .env.production is not in git, so it survives the reset.
  git reset -q --hard origin/main
  bash deploy/staging/start.sh
  docker image prune -f >/dev/null
fi
