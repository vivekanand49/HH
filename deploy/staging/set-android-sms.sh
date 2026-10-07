#!/bin/bash
# Free SMS for staging: an Android phone with the "SMS Gateway for Android" app
# (sms-gate.app, Cloud server mode) sends login codes from its own SIM. Run on the server:
#   sudo bash /opt/swasthya/deploy/staging/set-android-sms.sh
# Undo: set SMS_PROVIDER=console in /opt/swasthya/.env.production, then run start.sh.
set -euo pipefail
ENV_FILE=/opt/swasthya/.env.production

# Asks until there is an answer; spaces and stray Enters from pasting are ignored.
ask() { # ask <prompt> [secret]
  local answer=''
  while [[ -z $answer ]]; do
    if [[ ${2:-} == secret ]]; then read -rsp "$1" answer; echo; else read -rp "$1" answer; fi
    answer=$(printf '%s' "$answer" | tr -d '[:space:]')
  done
  REPLY=$answer
}

ask "Username from the app (Cloud server section): "; USER_NAME=$REPLY
ask "Password from the app (paste it; it stays hidden): " secret; PASS=$REPLY

sed -i '/^SMS_PROVIDER=/d;/^ANDROID_SMS_/d' "$ENV_FILE"
cat >> "$ENV_FILE" <<ENV
SMS_PROVIDER=android
ANDROID_SMS_USER=$USER_NAME
ANDROID_SMS_PASS=$PASS
ENV
chmod 600 "$ENV_FILE"

echo "Saved. Restarting the app (a few minutes)…"
bash /opt/swasthya/deploy/staging/start.sh
echo "Done. Login codes now go by SMS from your Android phone."
