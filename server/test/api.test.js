// End-to-end API tests against an in-memory PostgreSQL (PGlite).
process.env.PGLITE_DIR = 'memory://';
process.env.DATABASE_URL = '';
process.env.GATEWAY_SECRET = 'test-gateway-secret';
process.env.ANTHROPIC_API_KEY = '';
process.env.UPLOAD_DIR = (await import('node:os')).tmpdir() + '/swasthya-test-uploads-' + process.pid;
process.env.RAZORPAY_KEY_ID = '';
process.env.S3_BUCKET = '';
process.env.AUTH_RATE_LIMIT = '1000'; // all tests share one IP

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { createApp } = await import('../src/app.js');
const { migrate, closeDb, one } = await import('../src/db/index.js');
const { seed } = await import('../src/db/seed.js');
const { flushSms } = await import('../src/services/sms.js');

let base;
let server;

before(async () => {
  await migrate();
  await seed();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await flushSms();
  await closeDb();
});

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const sessions = new Map();
// Reuses one session per identity so the suite stays under the login rate limit.
async function login(method, value) {
  const key = `${method}:${value.replace(/\D/g, '')}`;
  if (sessions.has(key)) return sessions.get(key);
  const out = await freshLogin(method, value);
  sessions.set(key, out);
  return out;
}

async function freshLogin(method, value) {
  const req = await api('/auth/otp/request', { method: 'POST', body: { method, value } });
  assert.equal(req.status, 200, JSON.stringify(req.body));
  const bad = await api('/auth/otp/verify', {
    method: 'POST',
    body: { requestId: req.body.requestId, code: req.body.devCode === '000000' ? '111111' : '000000' },
  });
  assert.equal(bad.status, 400);
  const ok = await api('/auth/otp/verify', { method: 'POST', body: { requestId: req.body.requestId, code: req.body.devCode } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return ok.body;
}

test('login with mobile, Aadhaar and ABHA reaches the same demo patient', async () => {
  const a = await login('mobile', '98765 43210');
  const b = await login('aadhaar', '2345 6789 0123');
  const c = await login('abha', '91-1234-5678-9012');
  assert.equal(a.user.full_name, 'Lakshmi Devi');
  assert.equal(a.user.id, b.user.id);
  assert.equal(a.user.id, c.user.id);
  assert.equal(b.user.aadhaar_last4, '0123');
});

test('Twilio Verify: Twilio sends and checks the login code, which is never shown on screen', async () => {
  const http = await import('node:http');
  const { config } = await import('../src/config.js');
  const sent = [];
  const twilio = http
    .createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        res.setHeader('content-type', 'application/json');
        if (req.url === '/Services/VAtest/Verifications') sent.push(form.get('To'));
        res.end(JSON.stringify({ status: form.get('Code') === '424242' ? 'approved' : 'pending' }));
      });
    })
    .listen(0);
  const saved = { ...config };
  Object.assign(config, { smsProvider: 'twilio', twilioVerifyService: 'VAtest', twilioSid: 'ACtest', twilioToken: 'secret', twilioVerifyUrl: `http://127.0.0.1:${twilio.address().port}` });
  try {
    const req = await api('/auth/otp/request', { method: 'POST', body: { method: 'mobile', value: '91234 56780' } });
    assert.equal(req.status, 200);
    assert.equal(req.body.devCode, undefined);
    assert.deepEqual(sent, ['+919123456780']);
    const wrong = await api('/auth/otp/verify', { method: 'POST', body: { requestId: req.body.requestId, code: '111111' } });
    assert.equal(wrong.status, 400);
    const right = await api('/auth/otp/verify', { method: 'POST', body: { requestId: req.body.requestId, code: '424242' } });
    assert.equal(right.status, 200);
    assert.ok(right.body.token);
  } finally {
    Object.assign(config, saved);
    twilio.close();
  }
});

test('Android SMS gateway: the login code goes out as a normal SMS from the phone', async () => {
  const http = await import('node:http');
  const { config } = await import('../src/config.js');
  const got = [];
  const phone = http
    .createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        got.push({ auth: req.headers.authorization, ...JSON.parse(body) });
        res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'msg1', state: 'Pending' }));
      });
    })
    .listen(0);
  const saved = { ...config };
  Object.assign(config, { smsProvider: 'android', androidSmsUser: 'user', androidSmsPass: 'pass', androidSmsUrl: `http://127.0.0.1:${phone.address().port}` });
  try {
    const req = await api('/auth/otp/request', { method: 'POST', body: { method: 'mobile', value: '91234 56781' } });
    assert.equal(req.status, 200);
    await flushSms();
    assert.equal(got.length, 1);
    assert.deepEqual(got[0].phoneNumbers, ['+919123456781']);
    assert.equal(got[0].auth, `Basic ${Buffer.from('user:pass').toString('base64')}`);
    const code = got[0].textMessage.text.match(/\d{6}/)[0];
    const ok = await api('/auth/otp/verify', { method: 'POST', body: { requestId: req.body.requestId, code } });
    assert.equal(ok.status, 200);
  } finally {
    Object.assign(config, saved);
    phone.close();
  }
});

test('Traccar SMS Gateway: the login code goes out from the phone with the cloud token', async () => {
  const http = await import('node:http');
  const { config } = await import('../src/config.js');
  const got = [];
  const cloud = http
    .createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        got.push({ auth: req.headers.authorization, ...JSON.parse(body) });
        res.end();
      });
    })
    .listen(0);
  const saved = { ...config };
  Object.assign(config, { smsProvider: 'traccar', traccarSmsToken: 'tok123', traccarSmsUrl: `http://127.0.0.1:${cloud.address().port}/sms/` });
  try {
    const req = await api('/auth/otp/request', { method: 'POST', body: { method: 'mobile', value: '91234 56782' } });
    assert.equal(req.status, 200);
    await flushSms();
    assert.equal(got.length, 1);
    assert.equal(got[0].to, '+919123456782');
    assert.equal(got[0].auth, 'tok123');
    const code = got[0].message.match(/\d{6}/)[0];
    const ok = await api('/auth/otp/verify', { method: 'POST', body: { requestId: req.body.requestId, code } });
    assert.equal(ok.status, 200);
  } finally {
    Object.assign(config, saved);
    cloud.close();
  }
});

test('invalid Aadhaar is rejected and the OTP cannot be reused', async () => {
  assert.equal((await api('/auth/otp/request', { method: 'POST', body: { method: 'aadhaar', value: '123412341234' } })).status, 400);
  const req = await api('/auth/otp/request', { method: 'POST', body: { method: 'mobile', value: '9876543210' } });
  await api('/auth/otp/verify', { method: 'POST', body: { requestId: req.body.requestId, code: req.body.devCode } });
  const again = await api('/auth/otp/verify', { method: 'POST', body: { requestId: req.body.requestId, code: req.body.devCode } });
  assert.equal(again.status, 400);
});

test('hospitals come back nearest first and filter by type', async () => {
  const all = await api('/hospitals?lat=17.6912&lng=83.2178');
  assert.ok(all.body.hospitals.length >= 8);
  const d = all.body.hospitals.map((h) => h.distance_km);
  assert.deepEqual(
    d,
    [...d].sort((x, y) => x - y),
  );
  const gov = await api('/hospitals?type=government');
  assert.ok(gov.body.hospitals.every((h) => h.type === 'government'));
});

test('booking a slot works once; the second booking of the same slot is refused', async () => {
  const { token } = await login('mobile', '9876543210');
  const kgh = (await api('/hospitals?type=government')).body.hospitals.find((h) => h.name.startsWith('King George'));
  const doctors = (await api(`/hospitals/${kgh.id}/doctors?department=general`)).body.doctors;
  assert.ok(doctors.length >= 1);
  assert.equal(doctors[0].fee_inr, 0);
  const slot = (await api(`/doctors/${doctors[0].id}/slots`)).body.slots.find((s) => !s.is_booked);
  assert.ok(slot, 'expected a free slot');

  const first = await api('/appointments', { method: 'POST', token, body: { slotId: slot.id } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.appointment.status, 'confirmed');
  assert.match(first.body.appointment.token, /^[A-Z]-\d+$/);

  const second = await api('/appointments', { method: 'POST', token, body: { slotId: slot.id } });
  assert.equal(second.status, 409);

  const summary = await api('/me/summary', { token });
  assert.ok(summary.body.nextAppointment);
  assert.equal(summary.body.conditions.find((c) => c.kind === 'allergy').name, 'Penicillin');
});

test('app emergency alert: critical, nearest ER, ambulance assigned, retry is idempotent', async () => {
  const { token } = await login('mobile', '9876543210');
  const body = { clientRef: 'test-ref-00000001', symptoms: ['CHEST', 'BREATH'], lat: 17.6912, lng: 83.2178, accuracy: 12 };
  const first = await api('/emergency/alerts', { method: 'POST', token, body });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.alert.severity, 'critical');
  assert.equal(first.body.alert.status, 'dispatched');
  assert.ok(first.body.hospital.name.includes('Seaview'));
  assert.ok(first.body.ambulance.eta_min > 0);

  const retry = await api('/emergency/alerts', { method: 'POST', token, body });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.alert.id, first.body.alert.id);
});

test('anonymous alert needs a phone number', async () => {
  const res = await api('/emergency/alerts', { method: 'POST', body: { clientRef: 'anon-ref-000001', symptoms: ['BLEED'] } });
  assert.equal(res.status, 400);
});

test('SMS gateway turns an SOS SMS into an alert; missed call too', async () => {
  const user = await one(`SELECT sos_code FROM users WHERE phone = '+919876543210'`);
  const headers = { 'x-gateway-secret': 'test-gateway-secret' };
  assert.equal((await api('/gateway/sms', { method: 'POST', body: { from: '+919876543210', text: 'SOS' } })).status, 401);

  const sms = await api('/gateway/sms', {
    method: 'POST',
    headers,
    body: { from: '+919876543210', id: 'msg-1', text: `SOS P${user.sos_code} LOC17.8105,83.2051 PREG,BLEED SEV3` },
  });
  assert.equal(sms.status, 200, JSON.stringify(sms.body));
  const alert = await one(`SELECT * FROM emergency_alerts WHERE id = $1`, [sms.body.alert]);
  assert.equal(alert.channel, 'sms');
  assert.equal(alert.severity, 'high');
  assert.equal(alert.location_source, 'sms');

  const call = await api('/gateway/missed-call', { method: 'POST', headers, body: { from: '9876543210', id: 'call-1' } });
  const callAlert = await one(`SELECT * FROM emergency_alerts WHERE id = $1`, [call.body.alert]);
  assert.equal(callAlert.channel, 'missed_call');
  assert.equal(callAlert.severity, 'unknown');
  assert.equal(callAlert.location_source, 'last_known');
});

test('staff see their hospital queue with medical summary; patients cannot', async () => {
  const patient = await login('mobile', '9876543210');
  assert.equal((await api('/emergency/alerts', { token: patient.token })).status, 403);

  const dispatcher = await login('mobile', '9000000002');
  const list = await api('/emergency/alerts', { token: dispatcher.token });
  assert.equal(list.status, 200);
  assert.ok(list.body.alerts.length >= 3);
  assert.equal(list.body.alerts[0].severity, 'critical');

  const detail = await api(`/emergency/alerts/${list.body.alerts[0].id}`, { token: dispatcher.token });
  assert.deepEqual(detail.body.medical.allergies, ['Penicillin']);
  const ack = await api(`/emergency/alerts/${list.body.alerts[0].id}/ack`, { method: 'POST', token: dispatcher.token });
  assert.ok(ack.body.alert.acknowledged_at);
});

test('assistant sends urgent symptoms straight to emergency advice', async () => {
  const { token } = await login('mobile', '9876543210');
  const res = await api('/ai/chat', { method: 'POST', token, body: { language: 'te', messages: [{ role: 'user', content: 'ఛాతీ నొప్పి, ఊపిరి ఆడటం లేదు' }] } });
  assert.equal(res.status, 200);
  assert.equal(res.body.severity, 'critical');
  assert.equal(res.body.source, 'triage');
  assert.match(res.body.reply, /108/);
});

test('assistant chats without an AI key, then the fastest free slot can be booked', async () => {
  const { token } = await login('mobile', '9876543210');
  const chat = (messages) => api('/ai/chat', { method: 'POST', token, body: { language: 'en', messages } });
  const first = await chat([{ role: 'user', content: 'I have fever' }]);
  assert.equal(first.body.source, 'fallback');
  assert.equal(first.body.quickReplies.length, 3, 'asks a follow-up question with tap answers');
  const booked = await chat([{ role: 'user', content: 'book a doctor for fever' }]);
  assert.equal(booked.body.book, true);
  assert.equal(booked.body.department, 'general');

  const fast = await api('/fastest?department=general');
  assert.equal(fast.status, 200);
  assert.ok(fast.body.options.length > 0 && fast.body.options.length <= 3);
  const times = fast.body.options.map((o) => new Date(o.starts_at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'earliest first');
  assert.equal(new Set(fast.body.options.map((o) => o.hospital_id)).size, fast.body.options.length, 'one per hospital');
  const res = await api('/appointments', { method: 'POST', token, body: { slotId: fast.body.options[0].slot_id } });
  assert.equal(res.status, 201);
});

// ---------------- Step 3 ----------------

async function upload(path, token, bytes, type) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': type, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: bytes,
  });
  return { status: res.status, body: await res.json() };
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 2)]);

test('private booking holds the slot until paid (mock payment), then confirms', async () => {
  const { token } = await login('mobile', '9876543210');
  const sea = (await api('/hospitals?type=private')).body.hospitals.find((h) => h.name.startsWith('Seaview'));
  const doc = (await api(`/hospitals/${sea.id}/doctors?department=general`)).body.doctors[0];
  assert.ok(doc.fee_inr > 0);
  const slot = (await api(`/doctors/${doc.id}/slots`)).body.slots.find((s) => !s.is_booked);
  const booked = await api('/appointments', { method: 'POST', token, body: { slotId: slot.id } });
  assert.equal(booked.body.appointment.status, 'pending_payment');
  assert.equal(booked.body.paymentRequired, true);

  const order = await api('/payments/order', { method: 'POST', token, body: { appointmentId: booked.body.appointment.id } });
  assert.equal(order.status, 200, JSON.stringify(order.body));
  assert.equal(order.body.provider, 'mock');
  assert.equal(order.body.amount, doc.fee_inr * 100);
  const paid = await api('/payments/mock-complete', { method: 'POST', token, body: { orderId: order.body.orderId } });
  assert.equal(paid.status, 200);
  const after = await api(`/appointments/${booked.body.appointment.id}`, { token });
  assert.equal(after.body.appointment.status, 'confirmed');
  assert.equal(after.body.appointment.payment_status, 'paid');
  const again = await api('/payments/order', { method: 'POST', token, body: { appointmentId: booked.body.appointment.id } });
  assert.equal(again.status, 409);
});

test('unpaid holds are released after 15 minutes', async () => {
  const { releaseUnpaidHolds } = await import('../src/services/jobs.js');
  const { token } = await login('mobile', '9876543210');
  const sea = (await api('/hospitals?type=private')).body.hospitals.find((h) => h.name.startsWith('Seaview'));
  const doc = (await api(`/hospitals/${sea.id}/doctors?department=cardiology`)).body.doctors[0];
  const slot = (await api(`/doctors/${doc.id}/slots`)).body.slots.find((s) => !s.is_booked);
  const booked = await api('/appointments', { method: 'POST', token, body: { slotId: slot.id } });
  await one(`UPDATE appointments SET created_at = now() - interval '20 minutes' WHERE id = $1 RETURNING id`, [booked.body.appointment.id]);
  assert.ok((await releaseUnpaidHolds()) >= 1);
  const freed = await one(`SELECT is_booked FROM doctor_slots WHERE id = $1`, [slot.id]);
  assert.equal(freed.is_booked, false);
});

test('report photo upload: type is checked by content, owner can open it', async () => {
  const { token } = await login('mobile', '9876543210');
  const bad = await upload('/me/records/upload?title=X', token, Buffer.from('not really a png at all, just text'), 'image/png');
  assert.equal(bad.status, 400);
  const ok = await upload('/me/records/upload?title=Blood%20report&kind=lab', token, PNG, 'image/png');
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const recs = await api('/me/records', { token });
  const rec = recs.body.records.find((r) => r.title === 'Blood report');
  assert.equal(rec.uploaded, true);
  const file = await fetch(`${base}/files/${rec.file_id}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await file.arrayBuffer()).length, PNG.length);

  const stranger = await login('mobile', '9123456780');
  const denied = await fetch(`${base}/files/${rec.file_id}`, { headers: { authorization: `Bearer ${stranger.token}` } });
  assert.equal(denied.status, 404);
});

test('voice message attaches to an alert by clientRef, once', async () => {
  const alert = await api('/emergency/alerts', {
    method: 'POST',
    body: { clientRef: 'voice-ref-0001', symptoms: ['ACCID'], phone: '9123456781', lat: 17.7, lng: 83.3 },
  });
  assert.equal(alert.status, 201);
  assert.equal((await upload('/emergency/voice?clientRef=voice-ref-0001', null, PNG, 'audio/webm')).status, 400);
  const ok = await upload('/emergency/voice?clientRef=voice-ref-0001', null, WEBM, 'audio/webm');
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const dup = await upload('/emergency/voice?clientRef=voice-ref-0001', null, WEBM, 'audio/webm');
  assert.equal(dup.body.duplicate, true);
  assert.equal((await upload('/emergency/voice?clientRef=unknown-ref-0001', null, WEBM, 'audio/webm')).status, 404);
  const row = await one(`SELECT voice_file_id FROM emergency_alerts WHERE client_ref = 'voice-ref-0001'`);
  assert.ok(row.voice_file_id);
});

test('doctor sees patients, allergies, and completes a visit with a prescription', async () => {
  const doctor = await login('mobile', '9000000003');
  assert.equal(doctor.user.role, 'doctor');
  const list = await api('/doctor/appointments', { token: doctor.token });
  assert.equal(list.status, 200);
  const video = list.body.appointments.find((a) => a.visit_type === 'video' && a.status === 'confirmed');
  assert.ok(video, 'seeded video consult expected');

  const detail = await api(`/doctor/appointments/${video.id}`, { token: doctor.token });
  assert.deepEqual(detail.body.allergies, ['Penicillin']);
  assert.equal(detail.body.consent, true);

  const { consultAccess } = await import('../src/services/consult.js');
  const patientRow = await one(`SELECT * FROM users WHERE phone = '+919876543210'`);
  const strangerRow = await one(`SELECT * FROM users WHERE phone = '+919123456780'`);
  assert.equal((await consultAccess(video.id, patientRow)).role, 'patient');
  assert.equal((await consultAccess(video.id, doctor.user)).role, 'doctor');
  assert.equal(await consultAccess(video.id, strangerRow), null);

  const done = await api(`/doctor/appointments/${video.id}/complete`, {
    method: 'POST',
    token: doctor.token,
    body: {
      diagnosis: 'Type 2 diabetes, fair control',
      advice: 'Walk 30 minutes daily',
      followUpDays: 30,
      medicines: [{ name: 'Glimepiride', dose: '1 mg', times: ['08:00'], days: 30, instructions: 'Before breakfast' }],
    },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const patient = await login('mobile', '9876543210');
  const summary = await api('/me/summary', { token: patient.token });
  assert.ok(summary.body.medications.some((m) => m.name === 'Glimepiride'));
  const twice = await api(`/doctor/appointments/${video.id}/complete`, { method: 'POST', token: doctor.token, body: { diagnosis: 'again' } });
  assert.equal(twice.status, 409);

  const patientCannot = await api('/doctor/appointments', { token: patient.token });
  assert.equal(patientCannot.status, 403);
});

// ---------------- Step 4 ----------------

test('medicine reminders: sent once per dose, dead devices removed, SMS only if chosen', async () => {
  const { sendDueReminders } = await import('../src/services/reminders.js');
  const { config } = await import('../src/config.js');
  const saved = { pub: config.vapidPublicKey, priv: config.vapidPrivateKey };
  config.vapidPublicKey = 'test-public';
  config.vapidPrivateKey = 'test-private';
  try {
    const { token } = await login('mobile', '9876543210');
    const sub = { endpoint: 'https://push.example.org/device-1', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } };
    assert.equal((await api('/push/subscribe', { method: 'POST', token, body: sub })).status, 201);
    await api('/push/subscribe', { method: 'POST', token, body: { ...sub, endpoint: 'https://push.example.org/gone' } });
    await api('/me', { method: 'PATCH', token, body: { reminder_sms: true } });

    // Metformin is seeded at 08:00 and 20:00 India time.
    const at8 = new Date(`${new Date().toISOString().slice(0, 10)}T08:00:30+05:30`);
    const sent = [];
    const sender = async (s, payload) => {
      if (s.endpoint.endsWith('/gone')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) });
    };
    assert.ok((await sendDueReminders({ now: at8, sender })) >= 1);
    assert.ok(sent.some((x) => x.endpoint.endsWith('device-1') && /Metformin/.test(x.payload.body)));
    assert.equal(await one(`SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint LIKE '%/gone'`).then((r) => r.n), 0);
    const log = await one(`SELECT channels FROM reminder_log WHERE dose_time = '08:00' LIMIT 1`);
    assert.deepEqual(log.channels.sort(), ['push', 'sms']);

    sent.length = 0;
    assert.equal(await sendDueReminders({ now: at8, sender }), 0); // same minute again: nothing new
    assert.equal(sent.length, 0);

    await api('/me', { method: 'PATCH', token, body: { reminders_enabled: false, reminder_sms: false } });
    assert.equal(await sendDueReminders({ now: new Date(at8.getTime() + 12 * 3600 * 1000), sender }), 0); // 20:00, turned off
    await api('/me', { method: 'PATCH', token, body: { reminders_enabled: true } });
  } finally {
    config.vapidPublicKey = saved.pub;
    config.vapidPrivateKey = saved.priv;
  }
});

test('ASHA worker: register offline-safe, record vitals, book and raise emergency only for own villagers', async () => {
  const asha = await login('mobile', '9000000004');
  assert.equal(asha.user.role, 'health_worker');
  const list = await api('/hw/patients', { token: asha.token });
  assert.equal(list.body.patients.length, 2);

  const reg = { clientRef: 'hw-reg-0000001', full_name: 'Kondamma', gender: 'female', age_years: 66, village: 'Pedagantyada', consent: true };
  const first = await api('/hw/patients', { method: 'POST', token: asha.token, body: reg });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const again = await api('/hw/patients', { method: 'POST', token: asha.token, body: reg }); // replayed from the offline queue
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.patient.id, first.body.patient.id);
  assert.equal((await api('/hw/patients', { method: 'POST', token: asha.token, body: { ...reg, clientRef: 'hw-reg-0000002', consent: false } })).status, 400);

  const pid = first.body.patient.id;
  const v = await api(`/hw/patients/${pid}/vitals`, {
    method: 'POST',
    token: asha.token,
    body: { clientRef: 'hw-vit-0000001', systolic: 186, diastolic: 104, sugar_mgdl: 64, sugar_type: 'random' },
  });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.deepEqual(v.body.flags, ['bp_crisis', 'sugar_low']);
  assert.equal(
    (await api(`/hw/patients/${pid}/vitals`, { method: 'POST', token: asha.token, body: { clientRef: 'hw-vit-0000002', systolic: 120 } })).status,
    400,
  );

  const alert = await api(`/hw/patients/${pid}/alert`, {
    method: 'POST',
    token: asha.token,
    body: { clientRef: 'hw-sos-0000001', symptoms: ['CHEST'], lat: 17.66, lng: 83.2 },
  });
  assert.equal(alert.status, 201, JSON.stringify(alert.body));
  assert.equal(alert.body.alert.phone, '+919000000004'); // villager has no phone: call the ASHA
  assert.match(alert.body.alert.note, /health worker/);

  const kgh = (await api('/hospitals?type=government')).body.hospitals.find((h) => h.name.startsWith('King George'));
  const doc = (await api(`/hospitals/${kgh.id}/doctors?department=general`)).body.doctors[1];
  const slot = (await api(`/doctors/${doc.id}/slots`)).body.slots.find((s) => !s.is_booked);
  const booked = await api(`/hw/patients/${pid}/appointments`, { method: 'POST', token: asha.token, body: { slotId: slot.id, complaint: 'BP check' } });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.equal(booked.body.appointment.patient_id, pid);

  const detail = await api(`/hw/patients/${pid}`, { token: asha.token });
  assert.equal(detail.body.vitals.length, 1);
  assert.equal(detail.body.appointments.length, 1);

  // Not her villager, not her data.
  const lakshmi = await one(`SELECT id FROM users WHERE phone = '+919876543210'`);
  assert.equal((await api(`/hw/patients/${lakshmi.id}`, { token: asha.token })).status, 404);
  const patient = await login('mobile', '9876543210');
  assert.equal((await api('/hw/patients', { token: patient.token })).status, 403);
});

test('security: staff sessions are short, sign-out-everywhere revokes tokens, OTP requests are limited per person', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const staff = await freshLogin('mobile', '9000000001');
  const p = jwt.decode(staff.token);
  assert.ok(p.exp - p.iat <= 12 * 3600);
  const pat = await login('mobile', '9876543210');
  const pp = jwt.decode(pat.token);
  assert.ok(pp.exp - pp.iat >= 29 * 24 * 3600);

  const victim = await freshLogin('mobile', '9123456799');
  assert.equal((await api('/me', { token: victim.token })).status, 200);
  assert.equal((await api('/auth/logout-all', { method: 'POST', token: victim.token })).status, 200);
  assert.equal((await api('/me', { token: victim.token })).status, 401);

  let last;
  for (let i = 0; i < 6; i++) last = await api('/auth/otp/request', { method: 'POST', body: { method: 'mobile', value: '9123456788' } });
  assert.equal(last.status, 429);

  const res = await fetch(`${base}/health`);
  assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(res.headers.get('permissions-policy') || '', /camera=\(self\)/);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('Bhashini speech-to-text: real audio conversion, two-call flow, English copy for responders', async () => {
  const { spawnSync } = await import('node:child_process');
  const { default: ffmpegPath } = await import('ffmpeg-static');
  // One second of tone as WebM/Opus, like a phone recording.
  const webm = spawnSync(ffmpegPath, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-f', 'webm', 'pipe:1'], {
    maxBuffer: 1e7,
  }).stdout;
  assert.ok(webm.length > 100);

  const { toWav16k, transcribe } = await import('../src/services/speech.js');
  const wav = await toWav16k(webm);
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000); // sample rate
  assert.equal(wav.readUInt16LE(22), 1); // mono

  const { config } = await import('../src/config.js');
  Object.assign(config, { bhashiniUserId: 'u', bhashiniApiKey: 'k', bhashiniPipelineId: 'p' });
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const json = url.includes('getModelsPipeline')
      ? {
          pipelineResponseConfig: [{ config: [{ serviceId: 'asr-te' }] }],
          pipelineInferenceAPIEndPoint: { callbackUrl: 'https://compute.example/pipeline', inferenceApiKey: { name: 'Authorization', value: 'secret' } },
        }
      : { pipelineResponse: [{ taskType: 'asr', output: [{ source: ' బైక్ పడిపోయింది ' }] }] };
    return { ok: true, status: 200, json: async () => json };
  };
  try {
    assert.equal(await transcribe(webm, 'te', { fetchImpl: fakeFetch }), 'బైక్ పడిపోయింది');
    assert.equal(calls[0].headers.userID, 'u');
    assert.equal(calls[1].headers.Authorization, 'secret');
    assert.equal(calls[1].body.pipelineTasks[0].config.serviceId, 'asr-te');
    assert.equal(calls[1].body.pipelineTasks[0].config.audioFormat, 'wav');
    assert.ok(calls[1].body.inputData.audio[0].audioContent.length > 1000);

    const { transcribeAlertVoice } = await import('../src/services/voice.js');
    const alert = await one(`SELECT id FROM emergency_alerts WHERE client_ref = 'voice-ref-0001'`);
    await transcribeAlertVoice(alert.id, webm, 'te', { transcribe: async () => 'బైక్ పడిపోయింది', translate: async () => 'The bike fell down' });
    const row = await one(`SELECT voice_transcript, voice_transcript_en FROM emergency_alerts WHERE id = $1`, [alert.id]);
    assert.deepEqual(row, { voice_transcript: 'బైక్ పడిపోయింది', voice_transcript_en: 'The bike fell down' });
  } finally {
    Object.assign(config, { bhashiniUserId: '', bhashiniApiKey: '', bhashiniPipelineId: '' });
  }
});

test('audit log cannot be edited or deleted', async () => {
  const { query } = await import('../src/db/index.js');
  await assert.rejects(query(`UPDATE audit_log SET action = 'x'`), /append-only/);
  await assert.rejects(query(`DELETE FROM audit_log`), /append-only/);
});

test('hospital admin: beds, doctors, schedule, leave, staff — only for their own hospital', async () => {
  const admin = await login('mobile', '9000000005');
  const kgh = admin.user.hospital_id;
  const other = (await one(`SELECT id FROM hospitals WHERE name LIKE 'Seaview%'`)).id;
  const patient = await login('mobile', '9876543210');

  // Patients and other hospitals are off limits.
  assert.equal((await api('/admin/hospitals', { token: patient.token })).status, 403);
  assert.equal((await api(`/admin/hospitals/${other}`, { token: admin.token })).status, 404);
  const list = await api('/admin/hospitals', { token: admin.token });
  assert.deepEqual(
    list.body.hospitals.map((h) => h.id),
    [kgh],
  );

  // Beds: free cannot exceed total.
  assert.equal((await api(`/admin/hospitals/${kgh}/beds`, { method: 'PUT', token: admin.token, body: { beds_free: 999, er_beds_free: 1 } })).status, 400);
  const beds = await api(`/admin/hospitals/${kgh}/beds`, { method: 'PUT', token: admin.token, body: { beds_free: 30, er_beds_free: 0 } });
  assert.equal(beds.status, 200);
  assert.equal(beds.body.hospital.er_beds_free, 0);

  // Only district admin may rename.
  assert.equal((await api(`/admin/hospitals/${kgh}`, { method: 'PATCH', token: admin.token, body: { name: 'X hospital' } })).status, 400);

  // New doctor with a login, then a schedule.
  const doc = await api(`/admin/hospitals/${kgh}/doctors`, {
    method: 'POST',
    token: admin.token,
    body: { full_name: 'Dr. Test Rao', department: 'general', fee_inr: 0, login_phone: '9123456701', languages: ['Telugu'] },
  });
  assert.equal(doc.status, 201, JSON.stringify(doc.body));
  const did = doc.body.doctor.id;
  assert.equal(doc.body.doctor.has_login, true);
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const dow = new Date(`${tomorrow}T12:00:00+05:30`).getUTCDay();
  const sched = { from: tomorrow, to: tomorrow, weekdays: [dow], start: '09:00', end: '12:00', duration_min: 30, break_start: '10:30', break_end: '11:00' };
  const made = await api(`/admin/hospitals/${kgh}/doctors/${did}/schedule`, { method: 'POST', token: admin.token, body: sched });
  assert.equal(made.body.created, 5); // 09:00–12:00 in 30 min, minus the 10:30 break
  const again = await api(`/admin/hospitals/${kgh}/doctors/${did}/schedule`, { method: 'POST', token: admin.token, body: sched });
  assert.equal(again.body.created, 0); // running twice adds nothing

  // A patient books; blocking that slot is refused; leave cancels and notifies.
  const slots = await api(`/admin/hospitals/${kgh}/doctors/${did}/slots?from=${tomorrow}&days=1`, { token: admin.token });
  assert.equal(slots.body.slots.length, 5);
  const booked = await api('/appointments', { method: 'POST', token: patient.token, body: { slotId: slots.body.slots[0].id } });
  assert.equal(booked.status, 201);
  assert.equal(
    (await api(`/admin/hospitals/${kgh}/doctors/${did}/slots/${slots.body.slots[0].id}/block`, { method: 'POST', token: admin.token, body: { blocked: true } }))
      .status,
    409,
  );
  assert.equal(
    (await api(`/admin/hospitals/${kgh}/doctors/${did}/slots/${slots.body.slots[1].id}/block`, { method: 'POST', token: admin.token, body: { blocked: true } }))
      .status,
    200,
  );
  // Cannot deactivate a doctor with bookings.
  assert.equal((await api(`/admin/hospitals/${kgh}/doctors/${did}`, { method: 'PATCH', token: admin.token, body: { is_active: false } })).status, 409);
  const leave = await api(`/admin/hospitals/${kgh}/doctors/${did}/leave`, { method: 'POST', token: admin.token, body: { date: tomorrow } });
  assert.equal(leave.body.cancelled, 1);
  const appt = await one(`SELECT status, cancel_reason FROM appointments WHERE id = $1`, [booked.body.appointment.id]);
  assert.equal(appt.status, 'cancelled');
  const after = await api(`/admin/hospitals/${kgh}/doctors/${did}/slots?from=${tomorrow}&days=1`, { token: admin.token });
  assert.ok(after.body.slots.every((s) => s.state === 'blocked'));
  assert.equal((await api(`/admin/hospitals/${kgh}/doctors/${did}`, { method: 'PATCH', token: admin.token, body: { is_active: false } })).status, 200);

  // Staff: add, the new person can sign in, turning off signs them out.
  assert.equal(
    (
      await api(`/admin/hospitals/${kgh}/staff`, {
        method: 'POST',
        token: admin.token,
        body: { full_name: 'Existing', phone: '9876543210', role: 'hospital_staff' },
      })
    ).status,
    409,
  );
  const st = await api(`/admin/hospitals/${kgh}/staff`, {
    method: 'POST',
    token: admin.token,
    body: { full_name: 'Desk Nurse', phone: '9123456702', role: 'hospital_staff' },
  });
  assert.equal(st.status, 201);
  const nurse = await freshLogin('mobile', '9123456702');
  assert.equal(nurse.user.role, 'hospital_staff');
  assert.equal(
    (await api(`/admin/hospitals/${kgh}/staff/${st.body.staff.id}/active`, { method: 'POST', token: admin.token, body: { active: false } })).status,
    200,
  );
  assert.equal((await api('/me', { token: nurse.token })).status, 401);
  assert.equal(
    (await api(`/admin/hospitals/${kgh}/staff/${admin.user.id}/active`, { method: 'POST', token: admin.token, body: { active: false } })).status,
    400,
  );
});

test('district admin sees every hospital and adds one; ER routing skips a full ER nearby', async () => {
  const district = await login('mobile', '9000000006');
  const all = await api('/admin/hospitals', { token: district.token });
  assert.ok(all.body.hospitals.length >= 8);
  const created = await api('/admin/hospitals', {
    method: 'POST',
    token: district.token,
    body: { name: 'PHC Test Village', type: 'government', address: 'Test village road, Visakhapatnam', lat: 17.9, lng: 83.1, departments: ['general'] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const { pickEmergencyHospital } = await import('../src/services/alerts.js');
  const near = [
    { id: 'a', distance_km: 1, er_beds_free: 0 },
    { id: 'b', distance_km: 3, er_beds_free: 2 },
    { id: 'c', distance_km: 9, er_beds_free: 5 },
  ];
  assert.equal(pickEmergencyHospital(near).id, 'b');
  assert.equal(pickEmergencyHospital([near[0], near[2]]).id, 'a'); // too far: nearest still wins
});

test('family accounts: add a child, act for them, link an adult only with their OTP, either side can unlink', async () => {
  const g = await freshLogin('mobile', '9811111111');
  await api('/me', { method: 'PATCH', token: g.token, body: { full_name: 'Ravi Kumar' } });
  const as = (id) => ({ 'x-profile-id': id });

  // A child with no phone: created by the guardian, who becomes the emergency contact.
  const child = await api('/family', {
    method: 'POST',
    token: g.token,
    body: { relation: 'child', full_name: 'Anu Kumar', gender: 'female', date_of_birth: '2019-04-02' },
  });
  assert.equal(child.status, 201, JSON.stringify(child.body));
  const kid = child.body.member;
  assert.equal(kid.emergency_contact_name, 'Ravi Kumar');
  assert.equal((await api('/family', { token: g.token })).body.members.length, 1);

  // Acting for the child: /me, booking and SOS are theirs; the audit names the guardian.
  assert.equal((await api('/me', { token: g.token, headers: as(kid.id) })).body.user.full_name, 'Anu Kumar');
  const kgh = (await api('/hospitals?type=government')).body.hospitals.find((h) => h.name.startsWith('King George'));
  const doctor = (await api(`/hospitals/${kgh.id}/doctors?department=general`)).body.doctors[0];
  const slot = (await api(`/doctors/${doctor.id}/slots`)).body.slots.find((s) => !s.is_booked);
  const booked = await api('/appointments', { method: 'POST', token: g.token, headers: as(kid.id), body: { slotId: slot.id } });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.equal(booked.body.appointment.patient_id, kid.id);
  const log = await one(`SELECT actor_id FROM audit_log WHERE action = 'book' AND entity_id = $1`, [booked.body.appointment.id]);
  assert.equal(log.actor_id, g.user.id);
  assert.equal((await api('/me/appointments', { token: g.token })).body.appointments.length, 0); // guardian's own list is separate

  const sos = await api('/emergency/alerts', {
    method: 'POST',
    token: g.token,
    headers: as(kid.id),
    body: { clientRef: 'family-sos-0001', symptoms: ['FEVER'] },
  });
  assert.equal(sos.status, 201, JSON.stringify(sos.body));
  const alert = await one(`SELECT patient_id, phone, raised_by FROM emergency_alerts WHERE client_ref = 'family-sos-0001'`);
  assert.equal(alert.patient_id, kid.id);
  assert.equal(alert.phone, '+919811111111'); // call back the guardian
  assert.equal(alert.raised_by, g.user.id);

  // Nobody else can use the child's profile, and a bad header is refused rather than ignored.
  const other = await login('mobile', '9876543210');
  assert.equal((await api('/me', { token: other.token, headers: as(kid.id) })).status, 403);
  assert.equal((await api('/me', { token: g.token, headers: as('not-a-uuid') })).status, 403);

  // Staff accounts have no family profiles.
  const doc = await login('mobile', '9000000003');
  assert.equal((await api('/family', { method: 'POST', token: doc.token, body: { relation: 'child', full_name: 'Test Child' } })).status, 403);

  // An adult with a phone must agree: the code goes to their phone, not the guardian's.
  const ask = await api('/family', { method: 'POST', token: g.token, body: { relation: 'parent', full_name: 'Sita Kumar', phone: '98222 22222' } });
  assert.equal(ask.status, 202, JSON.stringify(ask.body));
  assert.equal(ask.body.sentTo, '+91 ••••• 2222');
  const sms = await one(`SELECT body FROM sms_log WHERE phone = '+919822222222' ORDER BY created_at DESC LIMIT 1`);
  assert.match(sms.body, /Ravi Kumar/);
  // The family code is not a login code, and only the asking guardian can use it.
  assert.equal((await api('/auth/otp/verify', { method: 'POST', body: { requestId: ask.body.requestId, code: ask.body.devCode } })).status, 400);
  assert.equal(
    (await api('/family/confirm', { method: 'POST', token: other.token, body: { requestId: ask.body.requestId, code: ask.body.devCode } })).status,
    400,
  );
  const wrong = ask.body.devCode === '000000' ? '111111' : '000000';
  assert.equal((await api('/family/confirm', { method: 'POST', token: g.token, body: { requestId: ask.body.requestId, code: wrong } })).status, 400);
  const ok = await api('/family/confirm', { method: 'POST', token: g.token, body: { requestId: ask.body.requestId, code: ask.body.devCode } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const parent = ok.body.member;
  assert.equal((await api('/family/confirm', { method: 'POST', token: g.token, body: { requestId: ask.body.requestId, code: ask.body.devCode } })).status, 400);

  // The parent sees who manages their profile, and can remove them.
  const p = await freshLogin('mobile', '9822222222');
  assert.equal(p.user.id, parent.id);
  const mine = (await api('/family', { token: p.token })).body;
  assert.deepEqual(
    mine.managedBy.map((x) => x.full_name),
    ['Ravi Kumar'],
  );
  assert.equal((await api('/me', { token: g.token, headers: as(parent.id) })).status, 200);
  assert.equal((await api(`/family/${g.user.id}`, { method: 'DELETE', token: p.token })).status, 200);
  assert.equal((await api('/me', { token: g.token, headers: as(parent.id) })).status, 403);
  assert.equal((await api('/family', { token: g.token })).body.members.length, 1);

  // The child's medicine reminder also reaches the guardian's phone, with the child's name.
  const { sendDueReminders } = await import('../src/services/reminders.js');
  const { config } = await import('../src/config.js');
  const saved = { pub: config.vapidPublicKey, priv: config.vapidPrivateKey };
  config.vapidPublicKey = 'test-public';
  config.vapidPrivateKey = 'test-private';
  try {
    await api('/push/subscribe', {
      method: 'POST',
      token: g.token,
      headers: as(kid.id),
      body: { endpoint: 'https://push.example.org/ravi', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } },
    });
    assert.equal((await one(`SELECT user_id FROM push_subscriptions WHERE endpoint = 'https://push.example.org/ravi'`)).user_id, g.user.id); // the device stays the guardian's
    await one(`INSERT INTO medications (patient_id, name, dose, times) VALUES ($1, 'Paracetamol syrup', '5 ml', '{09:15}') RETURNING id`, [kid.id]);
    const sent = [];
    await sendDueReminders({
      now: new Date(`${new Date().toISOString().slice(0, 10)}T09:15:10+05:30`),
      sender: async (s, payload) => sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) }),
    });
    const toRavi = sent.find((x) => x.endpoint.endsWith('/ravi'));
    assert.ok(toRavi, 'guardian should get the reminder');
    assert.match(toRavi.payload.title, /^Anu Kumar: /);
    assert.equal(toRavi.payload.profileId, kid.id);
  } finally {
    config.vapidPublicKey = saved.pub;
    config.vapidPrivateKey = saved.priv;
  }
});

test('pay at hospital counter: in-person visit confirmed now, hospital marks it collected; video must be paid online', async () => {
  const { token } = await login('mobile', '9876543210');
  const sea = (await api('/hospitals?type=private')).body.hospitals.find((h) => h.name.startsWith('Seaview'));
  const doc = (await api(`/hospitals/${sea.id}/doctors?department=general`)).body.doctors[0];
  const free = (await api(`/doctors/${doc.id}/slots`)).body.slots.filter((s) => !s.is_booked);

  const video = await api('/appointments', { method: 'POST', token, body: { slotId: free[0].id, visitType: 'video' } });
  assert.equal((await api('/payments/counter', { method: 'POST', token, body: { appointmentId: video.body.appointment.id } })).status, 400);

  const visit = await api('/appointments', { method: 'POST', token, body: { slotId: free[1].id } });
  assert.equal(visit.body.appointment.status, 'pending_payment');
  const counter = await api('/payments/counter', { method: 'POST', token, body: { appointmentId: visit.body.appointment.id } });
  assert.equal(counter.status, 200, JSON.stringify(counter.body));
  assert.equal(counter.body.appointment.status, 'confirmed');
  assert.equal(counter.body.appointment.payment_status, 'at_counter');
  const sms = await one(`SELECT body FROM sms_log WHERE phone = '+919876543210' ORDER BY created_at DESC LIMIT 1`);
  assert.match(sms.body, new RegExp(`Rs ${doc.fee_inr}`));
  // Not released like an unpaid online hold, and cannot be switched again.
  assert.equal((await api('/payments/counter', { method: 'POST', token, body: { appointmentId: visit.body.appointment.id } })).status, 409);

  const district = await login('mobile', '9000000006');
  const list = await api(`/admin/hospitals/${sea.id}/counter`, { token: district.token });
  assert.ok(list.body.counter.some((x) => x.id === visit.body.appointment.id));
  assert.equal((await api(`/admin/hospitals/${sea.id}`, { token: district.token })).body.counterDue >= 1, true);
  const kghAdmin = await login('mobile', '9000000005'); // another hospital's admin cannot
  assert.equal((await api(`/admin/hospitals/${sea.id}/counter/${visit.body.appointment.id}`, { method: 'POST', token: kghAdmin.token, body: { method: 'cash' } })).status, 404);
  const done = await api(`/admin/hospitals/${sea.id}/counter/${visit.body.appointment.id}`, { method: 'POST', token: district.token, body: { method: 'upi' } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await one(`SELECT payment_status FROM appointments WHERE id = $1`, [visit.body.appointment.id])).payment_status, 'paid');
});

test('SMS: queued first, sent in the background by a real provider, one retry, failures logged', async () => {
  const { config } = await import('../src/config.js');
  const { sendSms, sendTemplate } = await import('../src/services/sms.js');
  const saved = { ...config };
  const realFetch = globalThis.fetch;
  const calls = [];
  let failures = 1;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.twilio.com/')) return realFetch(url, init);
    calls.push({ url: String(url), body: new URLSearchParams(init.body), auth: init.headers.authorization });
    if (failures-- > 0) return new Response(JSON.stringify({ message: 'busy' }), { status: 503 });
    return new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 });
  };
  Object.assign(config, { smsProvider: 'twilio', twilioSid: 'AC1', twilioToken: 'tok', twilioFrom: '+15550001111', smsRetryMs: 0 });
  try {
    assert.equal(await sendTemplate('+919000011111', 'otp', 'te', '123456'), 'queued');
    await flushSms();
    assert.equal(calls.length, 2, 'retried once');
    assert.equal(calls[1].url, 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    assert.equal(calls[1].body.get('To'), '+919000011111');
    assert.match(calls[1].body.get('Body'), /123456 మీ స్వాస్థ్య సేతు/);
    assert.equal(calls[1].auth, `Basic ${Buffer.from('AC1:tok').toString('base64')}`);
    let log = await one(`SELECT * FROM sms_log WHERE phone = '+919000011111' ORDER BY created_at DESC LIMIT 1`);
    assert.deepEqual([log.status, log.provider_id, log.template, log.provider], ['sent', 'SM123', 'otp', 'twilio']);

    failures = 2;
    await sendSms('+919000022222', 'test');
    await flushSms();
    log = await one(`SELECT * FROM sms_log WHERE phone = '+919000022222'`);
    assert.equal(log.status, 'failed');
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(config, saved);
  }
});

test('security basics: headers, no staff numbers in public data, no stack traces', async () => {
  const res = await fetch(`${base}/hospitals`);
  assert.match(res.headers.get('strict-transport-security') ?? '', /max-age=\d+/);
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
  const { hospitals } = await res.json();
  assert.ok(hospitals.length > 0);
  for (const h of hospitals) assert.ok(!('sms_number' in h), 'booking SMS number is staff-only');
  const one = await api(`/hospitals/${hospitals[0].id}`);
  assert.ok(!('sms_number' in one.body.hospital));

  const bad = await fetch(`${base}/auth/otp/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"broken' });
  assert.equal(bad.status, 400);
  assert.doesNotMatch(await bad.text(), /at .*\.js:\d+/, 'no stack trace in errors');
});

test('staging: production build with demo login codes and demo payments; real production has neither', async () => {
  const { execFileSync } = await import('node:child_process');
  const read = (extra) =>
    JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '-e', `const { config } = await import('./src/config.js'); console.log(JSON.stringify({ echo: config.otpDevEcho, staging: config.staging }))`], {
        env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'x', ID_HASH_SECRET: 'y', GATEWAY_SECRET: 'z', OTP_DEV_ECHO: '', SMS_PROVIDER: '', ...extra },
      }),
    );
  assert.deepEqual(read({ STAGING: 'true' }), { echo: true, staging: true });
  // Staging with real SMS: the code goes to the phone, never on screen.
  assert.deepEqual(read({ STAGING: 'true', SMS_PROVIDER: 'twilio' }), { echo: false, staging: true });
  assert.deepEqual(read({ STAGING: '' }), { echo: false, staging: false });
  const cfg = await api('/emergency/config');
  assert.equal(cfg.body.staging, false);
});
