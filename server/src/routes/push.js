import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { parse } from '../validate.js';
import { requireAuth } from '../middleware/auth.js';
import { pushEnabled } from '../services/reminders.js';

const r = Router();

r.get('/key', (_req, res) => res.json({ enabled: pushEnabled(), publicKey: config.vapidPublicKey || null }));

const subSchema = z.object({
  endpoint: z.string().url().startsWith('https://').max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

r.post('/subscribe', requireAuth, async (req, res) => {
  const sub = parse(subSchema, req.body);
  // One device can only belong to one account at a time.
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [req.actor.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
  );
  res.status(201).json({ ok: true });
});

r.post('/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
  await query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [endpoint, req.actor.id]);
  res.json({ ok: true });
});

export default r;
