// Drops everything and reloads the demo data. Development only.
import { config } from '../config.js';
import { closeDb, db, migrate } from './index.js';
import { seed } from './seed.js';

if (config.isProd) throw new Error('Refusing to reset the database in production');

await (await db()).exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await migrate();
const summary = await seed();
await closeDb();
console.log('Database reset.', summary);
