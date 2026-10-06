// Booking a slot, used by patients and by ASHA workers booking for villagers.
import { tx } from '../db/index.js';
import { sendSms, sendTemplate } from './sms.js';
import { emit } from './realtime.js';
import { audit } from './audit.js';

const DEPT_EN = { general: 'General Medicine', diabetes: 'Diabetes', cardiology: 'Cardiology', pediatrics: 'Pediatrics', gynecology: 'Gynecology', orthopedics: 'Orthopedics', eye: 'Eye', neurology: 'Neurology' };
const LOCALES = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN', mr: 'mr-IN' };
export const when = (d, lang) =>
  new Date(d).toLocaleString(LOCALES[lang] || 'en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Claims a slot for `patient` and creates the appointment. Returns null if
 * the slot was just taken. `actorId` is who pressed the button (audit).
 */
export async function bookSlot({ patient, actorId, slotId, visitType = 'in_person', complaint }) {
  const booked = await tx(async (q) => {
    // Claim the slot atomically: if two people tap the same time, one wins.
    const { rows: [slot] } = await q.query(
      `UPDATE doctor_slots SET is_booked = true WHERE id = $1 AND NOT is_booked AND starts_at > now() RETURNING *`,
      [slotId],
    );
    if (!slot) return null;
    const { rows: [d] } = await q.query(
      `SELECT d.*, h.type AS hospital_type, h.name AS hospital_name, h.sms_number AS hospital_sms
         FROM doctors d JOIN hospitals h ON h.id = d.hospital_id WHERE d.id = $1`,
      [slot.doctor_id],
    );
    const { rows: [{ n }] } = await q.query(
      `SELECT count(*)::int + 1 AS n FROM appointments
        WHERE doctor_id = $1 AND (starts_at AT TIME ZONE 'Asia/Kolkata')::date = ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date`,
      [d.id, slot.starts_at],
    );
    const fee = d.hospital_type === 'government' ? 0 : visitType === 'video' ? (d.video_fee_inr ?? d.fee_inr) : d.fee_inr;
    const { rows: [appt] } = await q.query(
      `INSERT INTO appointments (patient_id, doctor_id, hospital_id, slot_id, starts_at, visit_type, status, token, room, fee_inr, payment_status, chief_complaint)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        patient.id, d.id, d.hospital_id, slot.id, slot.starts_at, visitType,
        fee > 0 ? 'pending_payment' : 'confirmed', `${d.opd_block}-${n}`, d.room, fee,
        fee > 0 ? 'pending' : 'not_required', complaint ?? null,
      ],
    );
    return { appt, d };
  });
  if (!booked) return null;

  const { appt, d } = booked;
  await audit(actorId, 'book', 'appointment', appt.id, actorId !== patient.id ? { for: patient.id } : null);
  const lang = patient.language;
  const sms = { hospital: d.hospital_name, when: when(appt.starts_at, lang), doctor: d.full_name, room: appt.room ?? '-', token: appt.token };
  if (appt.status === 'confirmed' && patient.phone) await sendTemplate(patient.phone, 'booked', lang, sms);
  if (d.hospital_sms) {
    await sendSms(
      d.hospital_sms,
      `[APPOINTMENT] ${patient.full_name ?? 'Patient'} · ${when(appt.starts_at, 'en')} · ${d.full_name} (${DEPT_EN[d.department] ?? d.department}) · Room ${appt.room ?? '-'} · Token ${appt.token}`,
      { template: 'appointment_hospital' },
    );
  }
  emit(`hospital:${d.hospital_id}`, 'appointment:new', { id: appt.id, starts_at: appt.starts_at, doctor: d.full_name });

  return {
    appointment: { ...appt, doctor_name: d.full_name, department: d.department, hospital_name: d.hospital_name, hospital_type: d.hospital_type },
    paymentRequired: appt.fee_inr > 0,
  };
}
