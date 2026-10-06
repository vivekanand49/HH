import http from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { createApp } from './app.js';
import { closeDb, migrate, one, query } from './db/index.js';
import { seed } from './db/seed.js';
import { setIo } from './services/realtime.js';
import { userFromToken, STAFF_ROLES } from './middleware/auth.js';
import { registerConsult } from './services/consult.js';
import { startJobs } from './services/jobs.js';
import { checkSmsConfig, flushSms } from './services/sms.js';

checkSmsConfig();

await migrate();
// First run on an empty database: load the demo data (never in production,
// where the district admin is created with `npm run create-admin`).
if ((!config.isProd || process.env.SEED_DEMO === 'true') && !(await one(`SELECT 1 FROM hospitals LIMIT 1`))) await seed();

const server = http.createServer(createApp());
const io = new Server(server, { cors: { origin: config.corsOrigins } });

io.use(async (socket, next) => {
  const user = await userFromToken(socket.handshake.auth?.token);
  if (!user) return next(new Error('unauthorized'));
  socket.data.user = user;
  next();
});

io.on('connection', async (socket) => {
  const u = socket.data.user;
  socket.join(`user:${u.id}`);
  registerConsult(io, socket);
  // Live updates (e.g. an SOS raised for a child) also reach the family members who manage them.
  if (u.role === 'patient') {
    const { rows } = await query(`SELECT member_id FROM family_links WHERE guardian_id = $1`, [u.id]);
    for (const r of rows) socket.join(`user:${r.member_id}`);
  }
  if ((STAFF_ROLES.includes(u.role) || u.role === 'hospital_admin') && u.hospital_id) socket.join(`hospital:${u.hospital_id}`);
  if (u.role === 'dispatcher' || u.role === 'admin') socket.join('dispatch');
});

setIo(io);
const stopJobs = startJobs();
server.listen(config.port, () => {
  console.log(`API on http://localhost:${config.port}  (db: ${config.databaseUrl ? 'postgres' : 'pglite'}, sms: ${config.smsProvider})`);
});

// On a deploy or restart: stop taking requests, finish SMS being sent, then close the database.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  setTimeout(() => process.exit(1), 15_000).unref();
  stopJobs();
  io.close();
  await new Promise((resolve) => server.close(resolve));
  await flushSms();
  await closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
