// Small periodic jobs. On more than one server instance, run these in one
// place only (or move them to a scheduled task).
import { tx } from '../db/index.js';
import { sendDueReminders } from './reminders.js';

const HOLD_MINUTES = 15;

// A private-hospital slot is held while the patient pays. Unpaid holds are
// released after 15 minutes so others can book the time.
export async function releaseUnpaidHolds() {
  return tx(async (q) => {
    const { rows } = await q.query(
      `UPDATE appointments SET status = 'cancelled'
        WHERE status = 'pending_payment' AND created_at < now() - interval '${HOLD_MINUTES} minutes'
        RETURNING slot_id`,
    );
    for (const { slot_id: slotId } of rows) {
      if (slotId) await q.query(`UPDATE doctor_slots SET is_booked = false WHERE id = $1`, [slotId]);
    }
    return rows.length;
  });
}

export function startJobs() {
  const run = () => releaseUnpaidHolds().catch((err) => console.error('releaseUnpaidHolds failed', err));
  const remind = () => sendDueReminders().catch((err) => console.error('sendDueReminders failed', err));
  run();
  const holds = setInterval(run, 60 * 1000).unref();
  // Reminders on the minute boundary so a 08:00 dose goes out at 08:00.
  const first = 60_000 - (Date.now() % 60_000) + 1000;
  let reminders;
  setTimeout(() => {
    remind();
    reminders = setInterval(remind, 60 * 1000).unref();
  }, first).unref();
  return () => {
    clearInterval(holds);
    clearInterval(reminders);
  };
}
