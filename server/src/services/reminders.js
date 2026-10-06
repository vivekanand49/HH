// Medicine reminders: every minute, find doses due now (India time) and send
// a push notification to each of the patient's devices, and to the phones of
// family members who manage their profile (a child's or elderly parent's doses). Patients who opted in
// (or have no device that can receive push) get an SMS instead.
import webpush from 'web-push';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { sendSms } from './sms.js';

const TEXT = {
  en: (m) => ({ title: 'Time for your medicine', body: `${m.name}${m.dose ? ` ${m.dose}` : ''}${m.instructions ? ` · ${m.instructions}` : ''}` }),
  te: (m) => ({ title: 'మందు వేసుకునే సమయం', body: `${m.name}${m.dose ? ` ${m.dose}` : ''}${m.instructions ? ` · ${m.instructions}` : ''}` }),
  hi: (m) => ({ title: 'दवा लेने का समय', body: `${m.name}${m.dose ? ` ${m.dose}` : ''}${m.instructions ? ` · ${m.instructions}` : ''}` }),
  mr: (m) => ({ title: 'औषध घेण्याची वेळ', body: `${m.name}${m.dose ? ` ${m.dose}` : ''}${m.instructions ? ` · ${m.instructions}` : ''}` }),
};

export const pushEnabled = () => Boolean(config.vapidPublicKey && config.vapidPrivateKey);

let configured = false;
function defaultSender(sub, payload) {
  if (!configured) {
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
    configured = true;
  }
  return webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 60 * 60, urgency: 'high' });
}

// India time now, as "YYYY-MM-DD" and "HH:MM".
export function istNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * Sends reminders for doses due at `now`. Returns how many doses were handled.
 * `sender` is injectable for tests.
 */
export async function sendDueReminders({ now = new Date(), sender = defaultSender } = {}) {
  const { date, time } = istNow(now);
  // Claim each due dose first (unique key), so two servers or a slow run never double-send.
  const { rows: due } = await query(
    `INSERT INTO reminder_log (medication_id, dose_date, dose_time)
     SELECT m.id, $1::date, $2 FROM medications m JOIN users u ON u.id = m.patient_id
      WHERE m.is_active AND u.is_active AND u.reminders_enabled AND $2 = ANY(m.times)
        AND (m.start_date IS NULL OR m.start_date <= $1::date) AND (m.end_date IS NULL OR m.end_date >= $1::date)
     ON CONFLICT (medication_id, dose_date, dose_time) DO NOTHING
     RETURNING id, medication_id`,
    [date, time],
  );
  for (const row of due) {
    const {
      rows: [m],
    } = await query(
      `SELECT m.name, m.dose, m.instructions, u.id AS user_id, u.full_name, u.phone, u.language, u.reminder_sms
         FROM medications m JOIN users u ON u.id = m.patient_id WHERE m.id = $1`,
      [row.medication_id],
    );
    const text = (TEXT[m.language] || TEXT.en)(m);
    const channels = [];

    if (pushEnabled()) {
      const { rows: subs } = await query(
        `SELECT * FROM push_subscriptions
          WHERE user_id = $1 OR user_id IN (SELECT guardian_id FROM family_links WHERE member_id = $1)`,
        [m.user_id],
      );
      const tag = `dose-${row.medication_id}-${time}`;
      for (const sub of subs) {
        // On a guardian's phone, say whose medicine it is.
        const own = sub.user_id === m.user_id;
        const payload = JSON.stringify({
          ...text,
          title: own ? text.title : `${m.full_name ?? ''}: ${text.title}`,
          url: '/',
          tag,
          ...(own ? {} : { profileId: m.user_id }),
        });
        try {
          await sender(sub, payload);
          if (!channels.includes('push')) channels.push('push');
        } catch (err) {
          // 404/410: the browser dropped this subscription; forget it.
          if (err.statusCode === 404 || err.statusCode === 410) await query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
          else console.warn('Push failed', err.statusCode ?? '', err.message);
        }
      }
    }
    // SMS only for people who chose it (e.g. a basic phone at home): it costs money.
    if (m.phone && m.reminder_sms) {
      await sendSms(m.phone, `${text.title}: ${text.body}`, { template: 'reminder', lang: m.language });
      channels.push('sms');
    }
    await query(`UPDATE reminder_log SET channels = $2 WHERE id = $1`, [row.id, channels]);
  }
  return due.length;
}
