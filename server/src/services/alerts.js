// Emergency alerts: one pipeline for every channel (app, SMS, missed call, voice).
import { triage } from '@swasthya/shared/triage';
import { etaMinutes } from '@swasthya/shared/geo';
import { one, query, tx } from '../db/index.js';
import { emit } from './realtime.js';
import { sendSms, sendTemplate } from './sms.js';
import { audit } from './audit.js';

// Distance in km; `t` is an optional table prefix like 'h.'.
export const DIST = (latParam, lngParam, t = '') => `(6371 * 2 * asin(sqrt(
  power(sin(radians(${t}lat - ${latParam}) / 2), 2) +
  cos(radians(${latParam})) * cos(radians(${t}lat)) * power(sin(radians(${t}lng - ${lngParam}) / 2), 2)
)))`;

export async function nearestHospitals(lat, lng, { emergencyOnly = false, type = null, limit = 20 } = {}) {
  const where = ['is_active'];
  const params = [lat, lng];
  if (emergencyOnly) where.push('has_emergency');
  if (type) {
    params.push(type);
    where.push(`type = $${params.length}`);
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT *, round(${DIST('$1', '$2')}::numeric, 1)::float AS distance_km
       FROM hospitals WHERE ${where.join(' AND ')}
      ORDER BY distance_km LIMIT $${params.length}`,
    params,
  );
  return rows;
}

async function nearestFreeAmbulance(q, lat, lng) {
  const { rows } = await q.query(
    `SELECT *, ${DIST('$1', '$2')} AS distance_km FROM ambulances
      WHERE status = 'free' AND lat IS NOT NULL ORDER BY distance_km LIMIT 1 FOR UPDATE SKIP LOCKED`,
    [lat, lng],
  );
  return rows[0] ?? null;
}

// Nearest ER, unless it reports no free ER bed and another ER with a free bed
// is at most ER_DETOUR_KM further. Bed counts come from the hospital admin portal.
const ER_DETOUR_KM = 5;
export function pickEmergencyHospital(nearest) {
  if (!nearest.length) return null;
  const limit = nearest[0].distance_km + ER_DETOUR_KM;
  return nearest.find((h) => h.er_beds_free > 0 && h.distance_km <= limit) ?? nearest[0];
}

const SEVERITY_ORDER = `CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'unknown' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END`;

export async function alertView(id) {
  return one(
    `SELECT a.*, u.full_name AS patient_name, u.gender, u.date_of_birth, u.blood_group, u.language,
            u.emergency_contact_name, u.emergency_contact_phone,
            h.name AS hospital_name, h.emergency_phone AS hospital_phone,
            am.registration AS ambulance_registration, am.driver_name, am.driver_phone
       FROM emergency_alerts a
       LEFT JOIN users u ON u.id = a.patient_id
       LEFT JOIN hospitals h ON h.id = a.hospital_id
       LEFT JOIN ambulances am ON am.id = a.ambulance_id
      WHERE a.id = $1`,
    [id],
  );
}

// Medical summary shown to responders. Emergency access is logged.
export async function medicalSummary(patientId, actorId) {
  if (!patientId) return null;
  const [conditions, meds] = await Promise.all([
    query(`SELECT kind, name, status FROM health_conditions WHERE patient_id = $1 AND status <> 'resolved'`, [patientId]),
    query(`SELECT name, dose FROM medications WHERE patient_id = $1 AND is_active`, [patientId]),
  ]);
  await audit(actorId, 'emergency_view', 'patient', patientId);
  return {
    allergies: conditions.rows.filter((c) => c.kind === 'allergy').map((c) => c.name),
    conditions: conditions.rows.filter((c) => c.kind === 'condition').map((c) => c.name),
    medications: meds.rows.map((m) => [m.name, m.dose].filter(Boolean).join(' ')),
  };
}

export async function openAlerts(hospitalId) {
  const params = [];
  let where = `status IN ('new', 'acknowledged', 'dispatched')`;
  if (hospitalId) {
    params.push(hospitalId);
    where += ` AND hospital_id = $1`;
  }
  const { rows } = await query(
    `SELECT id FROM emergency_alerts WHERE ${where} ORDER BY ${SEVERITY_ORDER}, created_at DESC LIMIT 100`,
    params,
  );
  return Promise.all(rows.map((r) => alertView(r.id)));
}

/**
 * Create an alert from any channel. Idempotent on clientRef, so a phone that
 * retries after a network drop (or the service worker replaying it) never
 * creates duplicates.
 */
export async function createAlert(input) {
  const { patient = null, phone = null, channel, clientRef = null, note = null, rawMessage = null, raisedBy = null } = input;

  if (clientRef) {
    const existing = await one(`SELECT id FROM emergency_alerts WHERE client_ref = $1`, [clientRef]);
    if (existing) return { alert: await alertView(existing.id), duplicate: true };
  }

  const codes = input.symptoms?.length ? input.symptoms : triage(note || '').codes;
  const severity = input.severity || triage(codes).severity || (channel === 'missed_call' ? 'unknown' : 'high');

  let { lat = null, lng = null, accuracy = null } = input;
  let locationSource = input.locationSource || (lat != null ? 'gps' : 'none');
  if (lat == null && patient?.lat != null) {
    ({ lat, lng } = patient);
    locationSource = 'last_known';
  }

  const hospital = lat != null ? pickEmergencyHospital(await nearestHospitals(lat, lng, { emergencyOnly: true, limit: 5 })) : null;

  const created = await tx(async (q) => {
    // Critical and high alerts get the nearest free ambulance straight away;
    // staff can reassign. Others wait for a human decision.
    const ambulance = lat != null && (severity === 'critical' || severity === 'high') ? await nearestFreeAmbulance(q, lat, lng) : null;
    const { rows } = await q.query(
      `INSERT INTO emergency_alerts
         (client_ref, patient_id, phone, channel, severity, symptoms, note, raw_message, lat, lng,
          location_accuracy_m, location_source, hospital_id, ambulance_id, status, dispatched_at, raised_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (client_ref) DO NOTHING
       RETURNING id`,
      [
        clientRef, patient?.id ?? null, phone ?? patient?.phone ?? null, channel, severity, codes, note, rawMessage,
        lat, lng, accuracy, locationSource, hospital?.id ?? null, ambulance?.id ?? null,
        ambulance ? 'dispatched' : 'new', ambulance ? new Date() : null, raisedBy,
      ],
    );
    if (!rows[0]) return null; // lost a race with the same client_ref
    if (ambulance) await q.query(`UPDATE ambulances SET status = 'busy', updated_at = now() WHERE id = $1`, [ambulance.id]);
    return { id: rows[0].id, ambulance };
  });

  if (!created) {
    const existing = await one(`SELECT id FROM emergency_alerts WHERE client_ref = $1`, [clientRef]);
    return { alert: await alertView(existing.id), duplicate: true };
  }

  const alert = await alertView(created.id);
  await audit(patient?.id, 'create', 'emergency_alert', alert.id, { channel, severity });
  emit([`hospital:${alert.hospital_id}`, 'dispatch'], 'alert:new', alert);

  // Notify the hospital and the family. (108/ERSS integration plugs in here.)
  const where = lat != null ? `https://maps.google.com/?q=${lat},${lng}` : 'location unknown';
  if (hospital?.sms_number) {
    await sendSms(
      hospital.sms_number,
      `[EMERGENCY ${severity.toUpperCase()}] ${alert.patient_name || phone || 'Unknown'} ${alert.phone || ''} · ${codes.join(', ') || 'no details'} · ${where}`,
      { alertId: alert.id, template: 'sos_hospital' },
    );
  }
  if (patient?.emergency_contact_phone) {
    await sendSms(
      patient.emergency_contact_phone,
      `${patient.full_name || 'Your family member'} asked for emergency help. Location: ${where}. Nearest hospital: ${hospital?.name || 'searching'}.`,
      { alertId: alert.id, template: 'sos_family' },
    );
  }
  if (created.ambulance && alert.phone) {
    const km = created.ambulance.distance_km;
    await sendTemplate(
      alert.phone,
      'dispatched',
      patient?.language,
      {
        reg: created.ambulance.registration,
        eta: etaMinutes(km),
        driver: created.ambulance.driver_name,
        phone: created.ambulance.driver_phone,
      },
      { alertId: alert.id },
    );
  }

  return {
    alert,
    hospital: hospital && { id: hospital.id, name: hospital.name, distance_km: hospital.distance_km, emergency_phone: hospital.emergency_phone },
    ambulance: created.ambulance && {
      registration: created.ambulance.registration,
      driver_name: created.ambulance.driver_name,
      driver_phone: created.ambulance.driver_phone,
      eta_min: etaMinutes(created.ambulance.distance_km),
    },
    duplicate: false,
  };
}

export async function updateAlertStatus(id, actor, status, extra = {}) {
  const sets = ['status = $2'];
  const params = [id, status];
  if (status === 'acknowledged' || extra.acknowledge) sets.push(`acknowledged_at = now()`, `acknowledged_by = $${params.push(actor.id)}`);
  if (status === 'dispatched' && !extra.acknowledge) {
    sets.push(`dispatched_at = now()`);
    if (extra.ambulanceId) sets.push(`ambulance_id = $${params.push(extra.ambulanceId)}`);
  }
  if (status === 'resolved' || status === 'cancelled') sets.push(`resolved_at = now()`);
  await query(`UPDATE emergency_alerts SET ${sets.join(', ')} WHERE id = $1`, params);
  if (extra.ambulanceId) await query(`UPDATE ambulances SET status = 'busy', updated_at = now() WHERE id = $1`, [extra.ambulanceId]);
  if (status === 'resolved' || status === 'cancelled') {
    await query(`UPDATE ambulances SET status = 'free', updated_at = now() WHERE id = (SELECT ambulance_id FROM emergency_alerts WHERE id = $1)`, [id]);
  }
  await audit(actor.id, status, 'emergency_alert', id);
  const alert = await alertView(id);
  emit([`hospital:${alert.hospital_id}`, 'dispatch', alert.patient_id && `user:${alert.patient_id}`], 'alert:update', alert);
  return alert;
}
