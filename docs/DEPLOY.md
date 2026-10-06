# Deploying Swasthya Setu for a pilot

One server runs the API and serves the app. PostgreSQL keeps the data.
For a pilot in one PHC area (a few thousand people) a single small server
is enough (see [LOAD-TEST.md](LOAD-TEST.md)).

## 1. What you need

- A Linux server in India (e.g. AWS `ap-south-1` Mumbai, 2 vCPU / 4 GB) with Docker, or any host with Node.js 20+.
- A domain name with HTTPS. Phones only allow the camera, microphone, location and install-to-home-screen on HTTPS.
- PostgreSQL 15+ (the `docker-compose.yml` includes one; a managed database such as AWS RDS is better: encrypted, backed up).
- An SMS account with DLT registration (see step 4).

## 2. Settings

```sh
cp server/.env.example .env.production
```

Fill in at least:

| Setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET`, `ID_HASH_SECRET`, `GATEWAY_SECRET` | three different long random strings: `openssl rand -hex 32` |
| `CORS_ORIGINS` | your site, e.g. `https://swasthya.example.org` |
| `TRUST_PROXY` | `1` behind one proxy / load balancer (the normal setup) |
| `SMS_PROVIDER` + SMS settings | step 4 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` (medicine reminders) |
| `S3_BUCKET` | optional: report photos and voice messages in S3 instead of the server disk |
| `RAZORPAY_*` | live keys for private-hospital payments |
| `ANTHROPIC_API_KEY`, `BHASHINI_*`, `TURN_*` | optional: assistant, speech-to-text, video on strict networks |

Keep `.env.production` private (`chmod 600`). Never commit it.
The server refuses to start in production without the three secrets.

## 3. Start

With Docker (app + PostgreSQL on one machine):

```sh
export POSTGRES_PASSWORD=$(openssl rand -hex 24)   # save it somewhere safe
docker compose up -d --build
docker compose exec app node server/src/db/create-admin.js +91XXXXXXXXXX "District Health Office"
curl http://127.0.0.1:4000/api/health             # {"ok":true,...}
```

Without Docker:

```sh
npm ci && npm run build
DATABASE_URL=postgres://... NODE_ENV=production npm start   # with the settings above in the environment
npm run create-admin -w server -- +91XXXXXXXXXX "District Health Office"
```

In production the database starts **empty**: no demo hospitals or demo logins.
The district admin signs in with their mobile number, opens **Hospital admin**,
adds the pilot hospitals and their hospital admins, who then add doctors, OPD
times, beds and staff. (`SEED_DEMO=true` loads the demo data, for a demo server only.)

Then put HTTPS in front. With Caddy, the whole config is:

```
swasthya.example.org {
    reverse_proxy 127.0.0.1:4000
}
```

The app needs WebSockets (live emergency desk, video calls); Caddy passes them by default.
On nginx add `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`.

## 4. SMS (required for OTP, bookings and SOS)

Indian telecom rules (TRAI DLT) allow only registered templates.

1. Register your organisation (principal entity) on a DLT portal (Jio, Airtel, Vodafone Idea or BSNL) and get a 6-letter sender ID, e.g. `SWSETU`.
2. Register each message in `server/src/services/sms.js` as a template, in every language you use: Telugu, Hindi and Marathi texts are separate templates. Variables (`{#var#}`) replace the names, times and codes.
3. Set `SMS_SENDER_ID`, `SMS_DLT_ENTITY_ID` and `SMS_DLT_TEMPLATES`, a JSON map from our template name to the DLT template ID, e.g. `{"otp":"1107...","otp.te":"1107..."}`. The names are listed in `.env.example`.
4. Choose the provider:
   - `SMS_PROVIDER=sns`: AWS SNS. Give the server's IAM role `sns:Publish`, and in the SNS console move the account out of the SMS sandbox and set a spending limit.
   - `SMS_PROVIDER=twilio`: set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` (or `TWILIO_MESSAGING_SERVICE_SID`).
5. Buy the SOS gateway number and missed-call number from your SMS provider, point their webhooks at `https://<site>/api/gateway/sms` and `/api/gateway/missed-call` with the `GATEWAY_SECRET`, and set `SMS_GATEWAY_NUMBER` and `MISSED_CALL_NUMBER`.

Every SMS is written to the `sms_log` table first (`queued`), then sent in the
background with one retry; the row ends as `sent` (with the provider's message
ID) or `failed`. Watch for `failed` rows:

```sql
SELECT created_at, phone, template, status FROM sms_log WHERE status = 'failed' ORDER BY created_at DESC LIMIT 20;
```

## 5. Before patients use it

- [ ] Independent VAPT passed (see [SECURITY.md](SECURITY.md)).
- [ ] Daily database backup, and one restore tested.
- [ ] Uptime check on `https://<site>/api/health` (answers 503 if the database is down) alerting the on-call person.
- [ ] Each SMS template sent once to a test phone in each language.
- [ ] One end-to-end emergency drill per hospital: SOS from the app, SOS by SMS, missed call, and the desk acknowledging and sending an ambulance.
- [ ] Staff trained on the emergency desk and admin portal. Staff screens are in English, Telugu, Hindi and Marathi.
- [ ] Clinicians have signed off the triage rules and first-aid text; native speakers have checked the translations.

## Free staging server (team testing)

A test copy for the team on one AWS Free Tier server (t3.micro, Mumbai), with
free HTTPS at `https://<ip-with-dashes>.sslip.io`. It runs with `STAGING=true`:
demo hospitals and logins, the login code shown on screen, demo payments, and a
"Test server" banner on every page. **Never put real patient data on it.**

- Launch an Amazon Linux 2023 t3.micro with `deploy/staging/setup.sh` as user data,
  a 30 GB gp3 disk, and a security group open only on ports 80 and 443.
  It installs Docker, clones the team repo and starts everything (about 15 minutes on first boot).
- Updates are automatic: every 5 minutes the server checks the team repo and rebuilds when `main` changed (a rebuild takes a few minutes). Log: `journalctl -u swasthya-update`.
- Setup log: `/var/log/swasthya-setup.log`. App logs: `sudo docker compose logs -f app`.
- Keep an AWS Budget alert at $1 so you hear about any charge.
- Real login SMS: run `sudo bash /opt/swasthya/deploy/staging/set-sms.sh` on the server and paste Twilio keys
  (a free Twilio trial sends only to phone numbers you verify in Twilio). From then on the code goes to the phone
  and is no longer shown on screen.

## Updating

```sh
git pull && docker compose up -d --build
```

The database schema updates itself on start. The server stops cleanly on
`SIGTERM`: it finishes SMS being sent before exiting.

## More than one server

Run a single instance for the pilot. Before adding a second: move rate limits
and Socket.io rooms to Redis, run the background jobs (unpaid holds, medicine
reminders) on one instance only, and store files in S3.
