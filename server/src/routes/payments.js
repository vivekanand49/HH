// Consultation fees for private hospitals.
// Razorpay (UPI, cards, net banking) when keys are set. Without keys, and only
// outside production, a "mock" provider lets the full flow be demoed.
import crypto from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { one, tx } from '../db/index.js';
import { parse } from '../validate.js';
import { requireAuth } from '../middleware/auth.js';
import { safeEqual } from '../services/ids.js';
import { sendSms, sendTemplate, template } from '../services/sms.js';
import { audit } from '../services/audit.js';

const r = Router();
const useRazorpay = () => Boolean(config.razorpayKeyId && config.razorpayKeySecret);
const mockAllowed = () => !useRazorpay() && (!config.isProd || config.staging);

async function razorpay(path, body) {
  const auth = Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error?.description || 'Payment provider error'), { status: 502 });
  return data;
}

// Marks the payment paid and confirms the appointment (idempotent).
async function markPaid(orderId, paymentId) {
  const done = await tx(async (q) => {
    const { rows: [p] } = await q.query(
      `UPDATE payments SET status = 'paid', payment_id = $2 WHERE order_id = $1 AND status <> 'paid' RETURNING *`,
      [orderId, paymentId],
    );
    if (!p) return null;
    const { rows: [a] } = await q.query(
      `UPDATE appointments SET status = 'confirmed', payment_status = 'paid' WHERE id = $1 AND status = 'pending_payment' RETURNING *`,
      [p.appointment_id],
    );
    return { p, a };
  });
  if (!done?.a) return done;
  const info = await one(
    `SELECT u.phone, u.language, d.full_name AS doctor, h.name AS hospital
       FROM appointments a JOIN users u ON u.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id JOIN hospitals h ON h.id = a.hospital_id
      WHERE a.id = $1`,
    [done.a.id],
  );
  if (info?.phone) {
    const when = new Date(done.a.starts_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    await sendTemplate(info.phone, 'booked', info.language, { hospital: info.hospital, when, doctor: info.doctor, room: done.a.room ?? '-', token: done.a.token });
  }
  await audit(done.p.patient_id, 'paid', 'appointment', done.a.id, { orderId, paymentId });
  return done;
}

async function pendingAppointment(id, userId) {
  return one(`SELECT * FROM appointments WHERE id = $1 AND patient_id = $2`, [id, userId]);
}

r.post('/order', requireAuth, async (req, res) => {
  const { appointmentId } = parse(z.object({ appointmentId: z.string().uuid() }), req.body);
  const appt = await pendingAppointment(appointmentId, req.user.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });
  if (appt.status !== 'pending_payment') return res.status(409).json({ error: 'This appointment does not need payment.' });

  if (useRazorpay()) {
    const order = await razorpay('/orders', { amount: appt.fee_inr * 100, currency: 'INR', receipt: appt.id.slice(0, 40), notes: { appointment_id: appt.id } });
    await one(`INSERT INTO payments (appointment_id, patient_id, provider, order_id, amount_inr) VALUES ($1, $2, 'razorpay', $3, $4) RETURNING id`, [
      appt.id, req.user.id, order.id, appt.fee_inr,
    ]);
    return res.json({ provider: 'razorpay', keyId: config.razorpayKeyId, orderId: order.id, amount: order.amount, currency: 'INR' });
  }
  if (!mockAllowed()) return res.status(503).json({ error: 'Online payment is not available right now. Please pay at the hospital counter.' });
  const orderId = `mock_${crypto.randomUUID()}`;
  await one(`INSERT INTO payments (appointment_id, patient_id, provider, order_id, amount_inr) VALUES ($1, $2, 'mock', $3, $4) RETURNING id`, [
    appt.id, req.user.id, orderId, appt.fee_inr,
  ]);
  res.json({ provider: 'mock', orderId, amount: appt.fee_inr * 100, currency: 'INR' });
});

// Offline payment: pay cash or UPI at the hospital counter on arrival. Only for
// in-person visits (a video consult has no counter). The visit is confirmed now;
// the hospital marks it paid when the money is collected (admin portal).
r.post('/counter', requireAuth, async (req, res) => {
  const { appointmentId } = parse(z.object({ appointmentId: z.string().uuid() }), req.body);
  const appt = await pendingAppointment(appointmentId, req.user.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });
  if (appt.status !== 'pending_payment') return res.status(409).json({ error: 'This appointment does not need payment.' });
  if (appt.visit_type !== 'in_person') return res.status(400).json({ error: 'Video consults must be paid online.' });
  const a = await one(
    `UPDATE appointments SET status = 'confirmed', payment_status = 'at_counter' WHERE id = $1 AND status = 'pending_payment' RETURNING *`,
    [appt.id],
  );
  if (!a) return res.status(409).json({ error: 'This appointment does not need payment.' });
  const info = await one(
    `SELECT u.phone, u.language, d.full_name AS doctor, h.name AS hospital
       FROM appointments a JOIN users u ON u.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id JOIN hospitals h ON h.id = a.hospital_id
      WHERE a.id = $1`,
    [a.id],
  );
  if (info?.phone) {
    const when = new Date(a.starts_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    await sendSms(
      info.phone,
      `${template('booked', info.language, { hospital: info.hospital, when, doctor: info.doctor, room: a.room ?? '-', token: a.token })} ${template('payAtCounter', info.language, a.fee_inr)}`,
      { template: 'booked_counter', lang: info.language },
    );
  }
  await audit(req.actor.id, 'pay_at_counter', 'appointment', a.id, req.actor.id !== req.user.id ? { for: req.user.id } : null);
  res.json({ appointment: a });
});

// Called by the app after Razorpay Checkout succeeds. The signature proves the
// payment came from Razorpay for this order.
r.post('/verify', requireAuth, async (req, res) => {
  const b = parse(
    z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }),
    req.body,
  );
  if (!useRazorpay()) return res.status(400).json({ error: 'Razorpay is not configured.' });
  const expected = crypto.createHmac('sha256', config.razorpayKeySecret).update(`${b.razorpay_order_id}|${b.razorpay_payment_id}`).digest('hex');
  if (!safeEqual(expected, b.razorpay_signature)) return res.status(400).json({ error: 'Payment could not be verified.' });
  const pay = await one(`SELECT * FROM payments WHERE order_id = $1 AND patient_id = $2`, [b.razorpay_order_id, req.user.id]);
  if (!pay) return res.status(404).json({ error: 'Payment not found' });
  await markPaid(b.razorpay_order_id, b.razorpay_payment_id);
  res.json({ ok: true });
});

r.post('/mock-complete', requireAuth, async (req, res) => {
  if (!mockAllowed()) return res.status(404).json({ error: 'Not found' });
  const { orderId } = parse(z.object({ orderId: z.string().startsWith('mock_') }), req.body);
  const pay = await one(`SELECT * FROM payments WHERE order_id = $1 AND patient_id = $2`, [orderId, req.user.id]);
  if (!pay) return res.status(404).json({ error: 'Payment not found' });
  await markPaid(orderId, `mockpay_${Date.now()}`);
  res.json({ ok: true });
});

// Razorpay server-to-server webhook: a backup in case the phone lost signal
// right after paying. Needs the raw body for the signature check.
r.post('/webhook', express.raw({ type: 'application/json', limit: '200kb' }), async (req, res) => {
  if (!config.razorpayWebhookSecret) return res.status(404).end();
  const expected = crypto.createHmac('sha256', config.razorpayWebhookSecret).update(req.body).digest('hex');
  if (!safeEqual(expected, req.get('x-razorpay-signature') || '')) return res.status(400).end();
  const event = JSON.parse(req.body.toString('utf8'));
  const entity = event.payload?.payment?.entity;
  if ((event.event === 'payment.captured' || event.event === 'order.paid') && entity?.order_id) {
    await markPaid(entity.order_id, entity.id);
  }
  res.json({ ok: true });
});

export default r;
