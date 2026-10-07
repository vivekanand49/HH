#!/bin/bash
# Free SMS for staging: an Android phone sends login codes from its own SIM, using
#   1) "Traccar SMS Gateway" (Play Store, by Anton Tananaev): cloud token, or
#   2) "SMS Gateway for Android" (sms-gate.app): Cloud server username + password.
# Run on the server:
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

APP=''
while [[ $APP != 1 && $APP != 2 ]]; do
  ask "Which app? 1 = Traccar SMS Gateway, 2 = SMS Gateway for Android (sms-gate.app): "; APP=$REPLY
done

sed -i '/^SMS_PROVIDER=/d;/^ANDROID_SMS_/d;/^TRACCAR_SMS_/d' "$ENV_FILE"
if [[ $APP == 1 ]]; then
  ask "Token from the Traccar app (paste it; it stays hidden): " secret
  printf 'SMS_PROVIDER=traccar\nTRACCAR_SMS_TOKEN=%s\n' "$REPLY" >> "$ENV_FILE"
else
  ask "Username from the app (Cloud server section): "; USER_NAME=$REPLY
  ask "Password from the app (paste it; it stays hidden): " secret
  printf 'SMS_PROVIDER=android\nANDROID_SMS_USER=%s\nANDROID_SMS_PASS=%s\n' "$USER_NAME" "$REPLY" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

echo "Saved. Restarting the app (a few minutes)…"
bash /opt/swasthya/deploy/staging/start.sh
echo "Done. Login codes now go by SMS from your Android phone."
