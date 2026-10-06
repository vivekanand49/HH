// One small interface over two drivers:
//  - node-postgres (pg) when DATABASE_URL is set: staging / production
//  - PGlite (PostgreSQL compiled to WASM, in-process) otherwise: local dev and tests
// Both speak real PostgreSQL SQL, so queries are identical.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let driver = null;

async function open() {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    return {
      kind: 'pg',
      query: (text, params) => pool.query(text, params),
      exec: (text) => pool.query(text),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: (t, p) => client.query(t, p) });
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const dir = config.pgliteDir;
  if (!dir.startsWith('memory://')) fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  const wrap = (res) => ({ rows: res.rows, rowCount: res.affectedRows ?? res.rows.length });
  return {
    kind: 'pglite',
    query: async (text, params) => wrap(await db.query(text, params)),
    exec: (text) => db.exec(text),
    tx: (fn) => db.transaction((t) => fn({ query: async (text, params) => wrap(await t.query(text, params)) })),
    close: () => db.close(),
  };
}

export async function db() {
  if (!driver) driver = await open();
  return driver;
}

export async function query(text, params = []) {
  return (await db()).query(text, params);
}

export async function one(text, params = []) {
  return (await query(text, params)).rows[0] ?? null;
}

export async function tx(fn) {
  return (await db()).tx(fn);
}

export async function migrate() {
  const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  await (await db()).exec(sql);
}

export async function closeDb() {
  if (driver) await driver.close();
  driver = null;
}
