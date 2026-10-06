# Security and privacy — Swasthya Setu

Status after Step 6 (September 2026). This is a self-review by the development
team, not an audit. A government deployment needs an independent security
audit (VAPT) by a CERT-In empanelled auditor before real patients use it.

## What is protected today

| Area | Protection | Where |
|---|---|---|
| Aadhaar | Never stored. Only a keyed HMAC (for lookup) and the last 4 digits. | `server/src/routes/auth.js` |
| Sign-in | 6-digit OTP, 5-minute expiry, 3 tries, single use, compared in constant time. Max 5 codes per person per hour (stops SMS-cost abuse) and 30 sign-in attempts per device per 15 minutes. | `routes/auth.js` |
| Sessions | Signed tokens (HS256 only). Patients 30 days; staff, doctors and health workers 12 hours. "Sign out on all devices" revokes every token at once. | `middleware/auth.js` |
| Access control | Every route checks role and ownership: patients see only their own data; hospital staff only their hospital's alerts; doctors only their own appointments; health workers only people they registered. | each route |
| Family accounts | Acting for a family member needs a family link, checked on every request, and only works for personal (patient) accounts. An adult with a phone is linked only after they share a one-time code sent to their own phone. That code works only for the guardian who asked and can never be used to sign in. Either side can remove the link. The audit log names the guardian who acted. | `middleware/auth.js`, `routes/family.js` |
| Consent (DPDP Act) | Records shared with doctors only with the patient's consent (toggle in Profile). Allergies always shown for safety. Health workers record spoken consent at registration. | `routes/doctor.js`, `routes/hw.js` |
| Audit | Logins, bookings, record/file views, emergency access and consent changes are logged. The log is append-only at the database level. | `services/audit.js`, `db/schema.sql` |
| Files | Type checked by file content, not name. Size limits. Stored with random names; S3 with server-side encryption and 5-minute links. Only owner, or consented staff, can open; each staff view logged. | `services/storage.js`, `routes/files.js` |
| Payments | Razorpay signatures verified (checkout and webhook). No card data touches our server. Demo payments impossible in production. | `routes/payments.js` |
| Web app | Strict Content Security Policy (only our code, Google Fonts, Razorpay), no framing, camera/mic/location limited to the app, no `X-Powered-By`. | `app.js` |
| Telecom webhooks | Shared secret, compared in constant time. | `routes/gateway.js` |
| Emergency | Works without sign-in (by design). Anonymous alerts are rate-limited and clearly marked "phone not verified" on the desk. | `routes/emergency.js`, `Console.jsx` |
| Video | Media goes directly between the two devices, encrypted (DTLS-SRTP). Only the patient and their doctor can join. Captions rate-limited. | `services/consult.js` |
| Secrets | Generated randomly by `npm run setup`; `.env` is private (mode 600) and git-ignored; the server refuses to start in production without them. | `config.js`, `scripts/setup.mjs` |
| Public data | Hospital lists show only what patients need; the staff number that receives booking SMS is left out. | `routes/hospitals.js` |
| Proxy / client IP | `TRUST_PROXY` says how many proxies are in front, so rate limits see the real phone's IP and users cannot fake it with `X-Forwarded-For`. | `config.js`, `app.js` |
| SMS | Sent in the background with one retry, so a slow SMS company cannot slow down an SOS. Every message is logged with its status. | `services/sms.js` |
| Dependencies | `npm audit`: 0 known vulnerabilities (27 Sept 2026). | — |
| Automated checks | `npm test` covers access control, family links, sessions, OTP limits, payments, security headers and the public data above. | `server/test/api.test.js` |

## Must do before a pilot

1. **Independent VAPT** by a CERT-In empanelled auditor; fix findings.
2. **HTTPS everywhere** (TLS 1.2+), HSTS, and a reverse proxy set up so `trust proxy` sees real client IPs (rate limits depend on it).
3. **Real identity:** Aadhaar OTP via a licensed AUA/KUA, or ABHA via the ABDM gateway (recommended). Remove the mock OTP path (`OTP_DEV_ECHO` is already off in production).
4. **Database:** managed PostgreSQL in an Indian region, encrypted at rest, daily backups with tested restore, separate least-privilege DB user for the app.
5. **Shared rate limits:** on more than one server, move rate limits and socket rooms to Redis.
6. **Monitoring:** alerts on failed logins, 5xx errors, emergency pipeline failures; keep logs 1+ year without personal data in plain text.
7. **Data retention and deletion** policy under the DPDP Act 2023: how long records, voice messages and audit logs are kept; a way for patients to download and delete their data.
8. **Staff accounts:** created only by an admin process (not self-signup); consider a second factor for staff.
9. **Tokens in the browser** are in `localStorage` (so the app works offline). The CSP limits the XSS risk; review again after any new third-party script.
10. **Clinical safety:** triage keywords, vitals warning levels and first-aid text reviewed and signed off by clinicians.

## For the VAPT auditor

Scope: the web app and API at the staging URL, the SMS/missed-call webhooks
(`/api/gateway/*`), the Razorpay webhook (`/api/payments/webhook`) and
Socket.io (`/socket.io`, video-call signalling and live desk updates).

Test accounts (staging only, `SEED_DEMO=true`; OTP is shown on screen only
when `OTP_DEV_ECHO=true`, turn that off for the final round):

| Role | Mobile | Can do |
|---|---|---|
| Patient | 9876543210 | own records, bookings, SOS, family |
| Doctor | 9000000003 | own appointments, consented records, prescriptions |
| Emergency desk (KGH) | 9000000001 | alerts routed to KGH |
| 108 control room | 9000000002 | all alerts, ambulances |
| Hospital admin (KGH) | 9000000005 | KGH beds, doctors, staff, refunds |
| District admin | 9000000006 | every hospital |
| ASHA worker | 9000000004 | villagers they registered |

Areas we ask the auditor to try hardest:

1. **Access control between people:** patient A reading B's records, files, appointments or alerts; a guardian acting for someone not linked (`X-Profile-Id`); a hospital admin changing another hospital; a doctor opening records without consent.
2. **Sign-in:** OTP guessing, reuse, expiry, per-person and per-device limits; token tampering (`alg`), revoked tokens after "sign out everywhere"; staff token lifetime.
3. **Uploads:** report photos and voice messages (type by content, size, path tricks, who can download).
4. **Webhooks:** forged SMS/missed-call and payment webhooks without the right secret or signature.
5. **Rate limits and cost abuse:** SMS pumping through OTP and family-link codes; anonymous SOS spam.
6. **Web:** XSS through names, notes, symptoms and the assistant; CSP bypass; tokens in `localStorage`.
7. **Socket.io:** joining another person's video call or another hospital's desk room.

Known and accepted for the pilot: the Aadhaar/ABHA OTP is a mock (item 3 below); tokens are in
`localStorage` for offline use (item 9); one server instance only (item 5).

## Reporting a problem

Report suspected security issues privately to the project lead. Do not post them in public issue trackers.
