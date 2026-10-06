import { one } from '../db/index.js';
import { newSosCode } from './ids.js';

// Creates a user row, retrying on the (very unlikely) SOS-code collision.
export async function createUser(fields) {
  for (let i = 0; i < 5; i++) {
    const cols = { ...fields, sos_code: newSosCode() };
    const keys = Object.keys(cols);
    try {
      return await one(`INSERT INTO users (${keys.join(', ')}) VALUES (${keys.map((_, j) => `$${j + 1}`).join(', ')}) RETURNING *`, Object.values(cols));
    } catch (err) {
      if (err.code !== '23505' || !String(err.detail || err.message).includes('sos_code')) throw err;
    }
  }
  throw new Error('Could not create user');
}
