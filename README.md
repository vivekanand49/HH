# Swasthya Setu

Offline-first healthcare PWA for Visakhapatnam and surrounding villages: Aadhaar / ABHA / mobile sign-in, government + private hospital booking, unified health records, a multilingual health assistant, and emergency alerts that still work on 2G, SMS-only, or no signal.

Languages: English, తెలుగు, हिन्दी, मराठी. Works on phones (Android, iPhone), tablets, laptops and PCs from one codebase.

## Try it (test server)

**https://43-204-211-180.sslip.io** (demo data only, never real patients).

Sign in with **Mobile**: the login code comes by SMS (Twilio Verify). On the free Twilio trial only numbers verified in the Twilio account get the code. Updates itself from this repo about 5 minutes after every push to `main`. Setup: [docs/DEPLOY.md](docs/DEPLOY.md#free-staging-server-team-testing).

## Run it

Needs Node.js 20+. No database install — development uses PGlite (real PostgreSQL inside Node).

```bash
npm install
npm run setup     # once: creates server/.env with random secrets and loads demo data
npm run dev       # API on :4000 + app on http://localhost:5173
```

Production-style (one server, built app):

```bash
npm run build && npm start    # http://localhost:4000
```

Tests: `npm test` (translation check, shared triage/SMS, full API tests against an in-memory database).
Load test: `npm run loadtest` (see [docs/LOAD-TEST.md](docs/LOAD-TEST.md)).
Deploying for a pilot: [docs/DEPLOY.md](docs/DEPLOY.md).

### Demo logins

In development the OTP is shown on screen ("Demo mode") and printed in the server log.

| Who | Sign in with |
|---|---|
| Patient Lakshmi Devi | Mobile `9876543210`, Aadhaar `2345 6789 0123` (not a real number) or ABHA `91-1234-5678-9012` |
| KGH emergency desk | Mobile `9000000001` (sees alerts routed to KGH) |
| 108 control room | Mobile `9000000002` (sees every alert) |
| Dr. Ramesh Varma (doctor app) | Mobile `9000000003` — has a video consult booked with Lakshmi |
| ASHA worker Sunitha (Pedagantyada) | Mobile `9000000004` — two villagers registered, with readings |
| KGH hospital admin | Mobile `9000000005` — beds, doctors, OPD times, leave, staff for KGH |
| District health office | Mobile `9000000006` — every hospital; can add hospitals |

The demo patient lives in Gajuwaka, so her alerts go to the nearest ER (Seaview, demo). Use the 108 login to see them.

### Try the SMS / missed-call path without a telecom provider

```bash
SECRET=$(grep GATEWAY_SECRET server/.env | cut -d= -f2)
curl -X POST localhost:4000/api/gateway/sms -H "x-gateway-secret: $SECRET" -H 'content-type: application/json' \
  -d '{"from":"+919876543210","text":"SOS LOC17.8105,83.2051 PREG,BLEED SEV3"}'
curl -X POST localhost:4000/api/gateway/missed-call -H "x-gateway-secret: $SECRET" -H 'content-type: application/json' \
  -d '{"from":"9876543210"}'
```

The alert appears live on the emergency desk.

## How emergency works when the network is bad

| Situation | What happens |
|---|---|
| Internet (even slow 2G) | Alert (< 1 KB) → server → nearest ER + nearest free ambulance + family SMS, in seconds. Saved to the phone first; retried automatically and replayed by the service worker if the send fails. Duplicate-safe via `clientRef`. |
| No internet, phone signal | One tap opens the SMS app with a ready message: `SOS P<code> LOC<lat>,<lng> <SYMPTOMS> SEV<n>` to the gateway number. Or one tap for a missed call — caller ID finds the patient and last known location. |
| No signal | Call 112 / 108 (emergency calls use any operator's tower). Offline first aid, cached nearby hospitals. The saved alert sends as soon as any connection returns. |

GPS works without internet. A web app cannot send SMS or place calls by itself — the user always taps once.

The health assistant runs a rule-based triage on the phone first (works offline, all 4 languages). Urgent symptoms go straight to emergency advice; everything else goes to Claude (`claude-opus-5`) when online. Without an AI key, or offline, a free built-in chat (`shared/chat.js`) answers instead: it asks since when and how bad, with tap answers, gives safe home-care tips and offers **Book fastest slot**. Four ways to talk, in all four languages: type or speak, and read or hear the answer (**Speak answers** switch). Speaking with Speak answers on is hands-free: the mic opens again after each answer. When the assistant offers booking, the earliest doctors appear right in the chat, and in hands-free mode you just say "yes". The free chat also answers greetings, "what can you do", medicine questions and emergency words. Voice uses the phone's own speech engine; when the phone has no Telugu or Marathi voice, the server speaks instead: **Bhashini**'s natural voice when its keys are set (`BHASHINI_*`), otherwise **eSpeak NG**, a free robot voice installed in the Docker image (`/api/speech/tts`). When the browser can't listen, Bhashini transcribes (`/api/speech/stt`). Demo and staging servers refill a week of free OPD slots every 6 hours. Voice problems show a clear message (mic blocked, nothing heard, no internet, no voice installed).

**Book by voice** (`/quick-book`, Home screen): say "fever for 3 days, doctor tomorrow", hear the earliest free doctor nearby (`GET /api/fastest`), and say "yes" to book or "no" for the next one. Typing works the same way.

## Step 3 features

- **Video consults** (`/consult/:id`): WebRTC directly between the two devices, 360p/15 fps capped at ~300 kbps, one-tap audio only. Live captions: each side's speech is recognised on their phone, translated by the server into the other person's language, and shown as subtitles. Needs a TURN server (`TURN_URL`) for phones on strict mobile networks. To try it: sign in as the patient in one browser and as the doctor (`9000000003`) in another, open the video appointment in both.
- **Payments**: private-hospital bookings hold the slot for 15 minutes while the patient pays with Razorpay (UPI, card, net banking). Signature-verified on return, plus a webhook as backup. Without keys (development only) a demo payment is used.
- **Report photos**: taken with the camera, shrunk on the phone (≈200–400 KB), checked by file content on the server, stored on disk or in S3 (encrypted). Only the patient, or doctors when the patient consents, can open them — every staff view is logged.
- **Voice SOS**: up to 1 minute, recorded on the phone even offline, sent with the alert and playable on the emergency desk.
- **Doctor app** (`/doctor`): this week's patients, allergies always shown, history with consent, join video, write diagnosis and prescription — medicines appear in the patient's app with reminders.

## Step 4 features

- **Medicine reminders**: a phone notification at each dose time (Web Push; keys made by `npm run setup`). Optional SMS for basic phones. Each dose is sent once, even if the job runs twice. iPhone needs "Add to Home Screen" first (iOS 16.4+).
- **ASHA health-worker mode** (`/worker`): register villagers (with spoken consent), record home-visit readings (BP, sugar, pulse, temperature, weight, oxygen) with instant warnings, raise emergencies and book visits for them. Works offline in the village; everything is queued on the phone and sent in order when there is signal.
- **Voice SOS speech-to-text** with **Bhashini** (Government of India): the voice message is converted to text in the caller's language, plus an English copy for responders, shown on the emergency desk. Needs `BHASHINI_USER_ID`, `BHASHINI_API_KEY`, `BHASHINI_PIPELINE_ID` (register at bhashini.gov.in). Without them, voice messages stay audio-only.
- **Security review and fixes**: see [docs/SECURITY.md](docs/SECURITY.md).

## Step 5 features

- **Family accounts** (Profile → Family): one phone manages the health of children and elderly parents. A member without a phone is created by the guardian, who becomes their emergency contact. A member with their own phone agrees first: a code goes to *their* phone and they read it out. Switch person from the Home screen; a banner shows whose profile is open, so nobody books for the wrong person. Booking, records, report uploads, payments, the assistant, video consults and SOS all work for the chosen person. The Emergency screen asks "Who needs help?". An SOS for a child with no phone gives the guardian's number for the call-back. The child's medicine reminders also appear on the guardian's phone. Either side can remove the link, and the member's records are kept. The server checks the link on every request (`X-Profile-Id`, `server/src/middleware/auth.js`). The audit log records who actually pressed the button.
- **Hospital admin portal** (`/admin`): free/total ward and ER beds (a full ER is skipped by emergency routing), doctors and their OPD times, doctor leave (booked patients get an SMS, paid visits go to Refunds), staff logins. The district admin sees every hospital and can add new ones.

## Step 6 features: ready for a pilot

- **Real SMS**: AWS SNS or Twilio (`SMS_PROVIDER`), with the Indian DLT entity and per-language template IDs. SMS are queued and sent in the background with one retry, so a slow SMS company never delays an SOS; each ends as `sent` or `failed` in `sms_log`.
- **Deployment**: `Dockerfile` + `docker-compose.yml` (app + PostgreSQL), `/api/health` checks the database, clean shutdown on restart. Production starts with an empty database (no demo data); `npm run create-admin` makes the first district admin. Step by step: [docs/DEPLOY.md](docs/DEPLOY.md).
- **Staff screens translated**: the hospital admin portal is now in Telugu, Hindi and Marathi too. `npm test` fails if any screen text is missing a translation.
- **Load test**: `npm run loadtest` simulates hundreds of patients signing in, booking and raising SOS. Results: [docs/LOAD-TEST.md](docs/LOAD-TEST.md).
- **Security**: hospital lists no longer expose the internal booking-SMS number; `TRUST_PROXY` setting so rate limits cannot be dodged with a fake IP; new automated header checks; VAPT scope and test accounts for the auditor in [docs/SECURITY.md](docs/SECURITY.md).

## Project layout

```
shared/   triage rules, SOS SMS format, geo helpers (used by app and server)
server/   Express API, Socket.io, PostgreSQL schema + seed, tests
client/   React 18 + Vite PWA, Tailwind, Redux Toolkit, i18next, IndexedDB
design-prototype/   Step 1 clickable design files
```

## Before a real pilot

- **Aadhaar / ABHA:** the OTP flow is a mock. Real Aadhaar OTP needs a UIDAI AUA/KUA licence; ABHA needs ABDM gateway integration (recommended — it is built for cross-hospital records).
- **SMS:** AWS SNS and Twilio are built in; register the DLT templates and set their IDs (see [docs/DEPLOY.md](docs/DEPLOY.md)). Buy the SOS gateway number and missed-call number and set them in `.env`.
- **108 / ERSS:** alerts reach hospitals and the 108 desk inside this app; integrating with the state 108 / ERSS 112 system is a government step.
- **Data:** replace demo hospitals, doctors and beds with the NHA Health Facility / Professional Registries. Private hospital names are fictional.
- **Review:** medical triage keywords, first-aid text and all translations need review by clinicians and native speakers.
- **Compliance:** DPDP Act 2023 consent (built in: consent toggle, audit log, emergency-access logging), ABDM data standards.

## Next steps

- Independent security audit (VAPT) on a staging server, then a small pilot in one PHC area.
- Repeat the load test on the staging server with real PostgreSQL.
