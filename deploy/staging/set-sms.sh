#!/bin/bash
# Turns on real SMS (Twilio) on the staging server: login codes go to the phone
# and are no longer shown on screen. Run on the server:
#   sudo bash /opt/swasthya/deploy/staging/set-sms.sh
# Undo: set SMS_PROVIDER=console in /opt/swasthya/.env.production, then run start.sh.
set -euo pipefail
ENV_FILE=/opt/swasthya/.env.production

# Asks until the answer matches; spaces and stray Enters from pasting are ignored.
ask() { # ask <prompt> <regex> [secret]
  local answer=''
  while true; do
    if [[ ${3:-} == secret ]]; then read -rsp "$1" answer; echo; else read -rp "$1" answer; fi
    answer=$(printf '%s' "$answer" | tr -d '[:space:]')
    [[ -z $answer ]] && continue
    [[ $answer =~ $2 ]] && break
    echo "That doesn't look right, please try again." >&2
  done
  REPLY=$answer
}

ask "Twilio Account SID (starts with AC): " '^AC[0-9a-fA-F]{32}$'; SID=$REPLY
ask "Twilio Auth Token (paste it; it stays hidden): " '^[0-9a-fA-F]{32}$' secret; TOKEN=$REPLY
ask "Twilio phone number (with +, e.g. +15551234567): " '^\+[0-9]{8,15}$'; FROM=$REPLY

sed -i '/^SMS_PROVIDER=/d;/^TWILIO_/d' "$ENV_FILE"
cat >> "$ENV_FILE" <<ENV
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=$SID
TWILIO_AUTH_TOKEN=$TOKEN
TWILIO_FROM=$FROM
ENV
chmod 600 "$ENV_FILE"

echo "Saved. Restarting the app (a few minutes)…"
bash /opt/swasthya/deploy/staging/start.sh
echo "Done. Login codes now go by SMS and are hidden on screen."
