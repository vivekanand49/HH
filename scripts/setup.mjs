// One-time local setup: creates server/.env from .env.example with strong
// random secrets, so logins and ID hashes stay valid across restarts.
// Safe to re-run: existing values are kept.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = path.join(root, 'server', '.env.example');
const target = path.join(root, 'server', '.env');

const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : fs.readFileSync(example, 'utf8');
const filled = current.replace(/^(JWT_SECRET|ID_HASH_SECRET|GATEWAY_SECRET)=\s*$/gm, (_, key) => `${key}=${crypto.randomBytes(32).toString('hex')}`);

let out = filled;
// Add any settings that are new in .env.example since this .env was made.
for (const line of fs.readFileSync(example, 'utf8').split('\n')) {
  const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
  if (key && !new RegExp(`^${key}=`, 'm').test(out)) out += `\n${line}`;
}
out = out.replace(/^(JWT_SECRET|ID_HASH_SECRET|GATEWAY_SECRET)=\s*$/gm, (_, key) => `${key}=${crypto.randomBytes(32).toString('hex')}`);

// Web Push keys for medicine reminders.
if (/^VAPID_PUBLIC_KEY=\s*$/m.test(out)) {
  const { default: webpush } = await import('web-push');
  const keys = webpush.generateVAPIDKeys();
  out = out.replace(/^VAPID_PUBLIC_KEY=\s*$/m, `VAPID_PUBLIC_KEY=${keys.publicKey}`).replace(/^VAPID_PRIVATE_KEY=\s*$/m, `VAPID_PRIVATE_KEY=${keys.privateKey}`);
}

fs.writeFileSync(target, out.endsWith('\n') ? out : `${out}\n`, { mode: 0o600 });
console.log(`server/.env ready (${target})`);
