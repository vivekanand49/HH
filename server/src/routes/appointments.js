import { Router } from 'express';
import { z } from 'zod';
import { one, tx } from '../db/index.js';
import { parse } from '../validate.js';
import { requireAuth } from '../middleware/auth.js';
import { bookSlot } from '../services/booking.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(requireAuth);

const bookSchema = z.object({
  slotId: z.string().uuid(),
  visitType: z.enum(['in_person', 'video']).default('in_person'),
  complaint: z.string().trim().max(500).optional(),
});

r.post('/', async (req, res) => {
  const body = parse(bookSchema, req.body);
  const out = await bookSlot({ patient: req.user, actorId: req.actor.id, ...body });
  if (!out) return res.status(409).json({ error: 'That time was just taken. Please pick another.' });
  res.status(201).json(out);
});

r.post('/:id/cancel', async (req, res) => {
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const out = await tx(async (q) => {
    const {
      rows: [appt],
    } = await q.query(
      `UPDATE appointments SET status = 'cancelled' WHERE id = $1 AND patient_id = $2 AND status IN ('confirmed', 'pending_payment') RETURNING *`,
      [id, req.user.id],
    );
    if (appt?.slot_id) await q.query(`UPDATE doctor_slots SET is_booked = false WHERE id = $1`, [appt.slot_id]);
    return appt;
  });
  if (!out) return res.status(404).json({ error: 'Appointment not found or already closed.' });
  await audit(req.actor.id, 'cancel', 'appointment', id, req.actor.id !== req.user.id ? { for: req.user.id } : null);
  res.json({ appointment: out });
});

r.get('/:id', async (req, res) => {
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const appt = await one(
    `SELECT a.*, d.full_name AS doctor_name, d.department, d.photo_url AS doctor_photo, h.name AS hospital_name, h.type AS hospital_type, h.address AS hospital_address, h.lat, h.lng
       FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN hospitals h ON h.id = a.hospital_id
      WHERE a.id = $1 AND a.patient_id = $2`,
    [id, req.user.id],
  );
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });
  res.json({ appointment: appt });
});

export default r;
