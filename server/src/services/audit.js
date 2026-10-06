import { query } from '../db/index.js';

// Who looked at or changed what. Required for health data (DPDP Act, ABDM).
export async function audit(actorId, action, entity, entityId, meta = null) {
  await query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, meta) VALUES ($1, $2, $3, $4, $5)`, [
    actorId ?? null,
    action,
    entity,
    entityId == null ? null : String(entityId),
    meta ? JSON.stringify(meta) : null,
  ]);
}
