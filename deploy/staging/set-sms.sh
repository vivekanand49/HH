#!/bin/bash
# Turns on real SMS (Twilio) on the staging server: login codes go to the phone
# and are no longer shown on screen. Run on the server:
#   sudo bash /opt/swasthya/deploy/staging/set-sms.sh
# Undo: set SMS_PROVIDER=console in /opt/swasthya/.env.production, then run start.sh.
set -euo pipefail
ENV_FILE=/opt/swasthya/.env.production

read -rp "Twilio Account SID (starts with AC): " SID
read -rsp "Twilio Auth Token (hidden while you type): " TOKEN
echo
read -rp "Twilio phone number (with +, e.g. +15551234567): " FROM
if [[ $SID != AC* || -z $TOKEN || $FROM != +* ]]; then
  echo "Those values don't look right. Nothing was changed."
  exit 1
fi

sed -i '/^SMS_PROVIDER=/d;/^TWILIO_/d' "$ENV_FILE"
cat >> "$ENV_FILE" <<ENV
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=$SID
TWILIO_AUTH_TOKEN=$TOKEN
TWILIO_FROM=$FROM
ENV
chmod 600 "$ENV_FILE"

bash /opt/swasthya/deploy/staging/start.sh
echo "Done. Login codes now go by SMS and are hidden on screen."
