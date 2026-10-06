#!/bin/bash
# Makes the staging server update itself from GitHub every 5 minutes.
# Log: journalctl -u swasthya-update
set -euo pipefail
cat > /etc/systemd/system/swasthya-update.service <<UNIT
[Unit]
Description=Swasthya Setu staging: update from GitHub
After=swasthya.service

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/swasthya/deploy/staging/update.sh
UNIT
cat > /etc/systemd/system/swasthya-update.timer <<UNIT
[Unit]
Description=Check GitHub for Swasthya Setu updates every 5 minutes

[Timer]
OnBootSec=5min
OnUnitInactiveSec=5min

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now swasthya-update.timer
echo "Auto-update on: checks GitHub every 5 minutes."
