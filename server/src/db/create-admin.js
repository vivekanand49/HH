// Creates the first district admin on a new (production) database, who then
// adds hospitals and hospital admins from the admin portal.
//   npm run create-admin -w server -- +919XXXXXXXXX "District Health Office"
// In Docker: docker compose exec app node server/src/db/create-admin.js +919XXXXXXXXX "Name"
import { closeDb, migrate, one } from './index.js';
import { createUser } from '../services/users.js';
import { normalizePhone } from '../services/ids.js';

const [rawPhone, ...name] = process.argv.slice(2);
const phone = normalizePhone(rawPhone ?? '');
if (!phone) {
  console.error('Usage: create-admin <mobile number> "<name>"');
  process.exit(1);
}
await migrate();
const existing = await one(`SELECT id, role FROM users WHERE phone = $1`, [phone]);
if (existing && existing.role !== 'admin') {
  console.error(`${phone} already has a ${existing.role} account. Use another number.`);
  process.exitCode = 1;
} else if (existing) {
  console.log(`${phone} is already a district admin.`);
} else {
  await createUser({ role: 'admin', phone, full_name: name.join(' ') || 'District Health Office' });
  console.log(`District admin ${phone} created. Sign in at /login with this number, then open Hospital admin.`);
}
await closeDb();
