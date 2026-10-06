import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { one, query } from '../db/index.js';
import { parse } from '../validate.js';
import { requireAuth } from '../middleware/auth.js';
import { assistantReply } from '../services/ai.js';

const r = Router();
r.use(requireAuth, rateLimit({ windowMs: 60 * 1000, limit: 20, message: { error: 'Too many messages. Please wait a minute.' } }));

const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  language: z.enum(['en', 'te', 'hi', 'mr']).optional(),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
    .min(1)
    .max(30),
});

async function patientContext(user) {
  if (!user.records_consent_at) return '';
  const [cond, meds] = await Promise.all([
    query(`SELECT kind, name FROM health_conditions WHERE patient_id = $1 AND status <> 'resolved'`, [user.id]),
    query(`SELECT name, dose FROM medications WHERE patient_id = $1 AND is_active`, [user.id]),
  ]);
  const allergies = cond.rows.filter((c) => c.kind === 'allergy').map((c) => c.name);
  const conditions = cond.rows.filter((c) => c.kind === 'condition').map((c) => c.name);
  return [
    conditions.length && `conditions: ${conditions.join(', ')}`,
    allergies.length && `allergies: ${allergies.join(', ')}`,
    meds.rows.length && `current medicines: ${meds.rows.map((m) => `${m.name} ${m.dose ?? ''}`.trim()).join(', ')}`,
  ]
    .filter(Boolean)
    .join('; ');
}

r.post('/chat', async (req, res) => {
  const body = parse(chatSchema, req.body);
  const lang = body.language ?? req.user.language;
  const result = await assistantReply({ messages: body.messages, lang, context: await patientContext(req.user) });

  const transcript = JSON.stringify([...body.messages, { role: 'assistant', content: result.reply }]);
  let conversationId = body.conversationId;
  const updated = conversationId
    ? await one(
        `UPDATE ai_conversations SET messages = $3::jsonb, severity = $4 WHERE id = $1 AND patient_id = $2 RETURNING id`,
        [conversationId, req.user.id, transcript, result.severity],
      )
    : null;
  if (!updated) {
    conversationId = (
      await one(`INSERT INTO ai_conversations (patient_id, language, messages, severity) VALUES ($1, $2, $3::jsonb, $4) RETURNING id`, [
        req.user.id,
        lang,
        transcript,
        result.severity,
      ])
    ).id;
  }
  res.json({ ...result, conversationId });
});

export default r;
