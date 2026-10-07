#!/bin/bash
# Turns on Bhashini (Government of India, free) for speech in Telugu, Hindi,
# Marathi and English: the assistant can speak and listen on any phone, and
# SOS voice messages get a transcript. Run on the server:
#   sudo bash /opt/swasthya/deploy/staging/set-bhashini.sh
# Keys: register at bhashini.gov.in (ULCA), then My Profile shows the User ID
# and lets you generate an API key.
set -euo pipefail
ENV_FILE=/opt/swasthya/.env.production
# MeitY's public pipeline on Bhashini; press Enter to keep it.
DEFAULT_PIPELINE=64392f96daac500b55c543cd

# Asks until there is an answer; spaces and stray Enters from pasting are ignored.
ask() { # ask <prompt> [secret]
  local answer=''
  while [[ -z $answer ]]; do
    if [[ ${2:-} == secret ]]; then read -rsp "$1" answer; echo; else read -rp "$1" answer; fi
    answer=$(printf '%s' "$answer" | tr -d '[:space:]')
  done
  REPLY=$answer
}

ask "Bhashini User ID: "; USER_ID=$REPLY
ask "Bhashini API key (paste it; it stays hidden): " secret; KEY=$REPLY
read -rp "Pipeline ID (press Enter for $DEFAULT_PIPELINE): " PIPELINE
PIPELINE=$(printf '%s' "${PIPELINE:-$DEFAULT_PIPELINE}" | tr -d '[:space:]')

sed -i '/^BHASHINI_/d' "$ENV_FILE"
printf 'BHASHINI_USER_ID=%s\nBHASHINI_API_KEY=%s\nBHASHINI_PIPELINE_ID=%s\n' "$USER_ID" "$KEY" "$PIPELINE" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "Saved. Restarting the app (a few minutes)…"
bash /opt/swasthya/deploy/staging/start.sh
echo "Done. Bhashini voice is on."
