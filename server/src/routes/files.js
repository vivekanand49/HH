import { Router } from 'express';
import { z } from 'zod';
import { one } from '../db/index.js';
import { parse } from '../validate.js';
import { requireAuth, STAFF_ROLES } from '../middleware/auth.js';
import { sendFile } from '../services/storage.js';
import { audit } from '../services/audit.js';

const r = Router();

// Who may open a file:
//  - the owner (the patient)
//  - staff/doctors: SOS voice messages always; report files only if the
//    patient has given records consent. Every staff view is audited.
r.get('/:id', requireAuth, async (req, res) => {
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const file = await one(
    `SELECT f.*, u.records_consent_at FROM files f LEFT JOIN users u ON u.id = f.owner_id WHERE f.id = $1`,
    [id],
  );
  if (!file) return res.status(404).json({ error: 'File not found' });

  const isOwner = file.owner_id === req.user.id;
  const staffAllowed = STAFF_ROLES.includes(req.user.role) && (file.kind === 'voice' || file.records_consent_at);
  if (!isOwner && !staffAllowed) return res.status(404).json({ error: 'File not found' });
  if (!isOwner) await audit(req.user.id, 'view_file', 'file', file.id, { owner: file.owner_id });

  await sendFile(res, file);
});

export default r;
