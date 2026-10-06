// Load test: many patients using the app at once, with no extra tools needed.
//
//   npm run loadtest                         fresh server + in-memory database, 100 users, 60 s
//   npm run loadtest -- --users 300 --duration 120
//   npm run loadtest -- --url https://staging.example.org   an existing STAGING server
//
// Each virtual user signs in with its own mobile number, then loops through a
// realistic mix: find hospitals and doctors, open home/records, book and
// cancel an appointment, and now and then raise and cancel an SOS. Each user
// looks like its own phone (X-Forwarded-For), as the per-device limits expect.
// Sign-in needs the development OTP echo, so this cannot run against production.
import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((a) => a.trim().split(/\s+/)),
);
const USERS = Number(args.users ?? 100);
const DURATION = Number(args.duration ?? 60) * 1000;
const THINK_MS = Number(args.think ?? 1000); // pause between a user's actions, like a real person

const here = path.dirname(fileURLToPath(import.meta.url));
let base = args.url?.replace(/\/$/, '');
let child = null;

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(here, '../server'),
    env: { ...process.env, PORT: String(port), PGLITE_DIR: 'memory://', DATABASE_URL: '', NODE_ENV: 'development', OTP_DEV_ECHO: 'true', SMS_PROVIDER: 'console' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not start');
}

// ---- measurements ----
const stats = new Map();
function record(name, ms, status, ok) {
  let s = stats.get(name);
  if (!s) stats.set(name, (s = { times: [], errors: 0, noAnswer: 0 }));
  s.times.push(ms);
  if (!status) s.noAnswer++;
  else if (!ok) s.errors++;
}

// Plain http with keep-alive (like a phone reusing its connection); Node's
// fetch hits a socket bug on macOS under this much load.
const agents = { 'http:': new http.Agent({ keepAlive: true }), 'https:': new https.Agent({ keepAlive: true }) };
function request(url, { method, headers, body }) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).request(u, { method, headers, agent: agents[u.protocol], timeout: 30_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let data = null;
        try {
          data = JSON.parse(Buffer.concat(chunks));
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode, data });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

async function call(user, name, pathname, { method = 'GET', body, expect = [200, 201] } = {}) {
  const t0 = performance.now();
  let res = {};
  try {
    res = await request(`${base}/api${pathname}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': user.ip,
        ...(user.token ? { authorization: `Bearer ${user.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    res.error = err.code || err.message; // no answer: connection refused, reset or timeout
  }
  const ok = expect.includes(res.status);
  record(name, performance.now() - t0, res.status, ok);
  if (!ok && process.env.DEBUG) console.error(name, res.status ?? res.error, res.data?.error ?? '');
  return ok ? res.data : null;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- what one person does ----
async function signIn(i) {
  const user = { ip: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, phone: `9${String(700000000 + i)}` };
  const req = await call(user, 'sign in: request OTP', '/auth/otp/request', { method: 'POST', body: { method: 'mobile', value: user.phone } });
  if (!req?.devCode) throw new Error('No development OTP in the response: run this only against a development or staging server with OTP_DEV_ECHO=true.');
  const ok = await call(user, 'sign in: verify OTP', '/auth/otp/verify', { method: 'POST', body: { requestId: req.requestId, code: req.devCode } });
  user.token = ok?.token;
  return user;
}

let codes = [];
async function actions(user) {
  const r = Math.random();
  if (r < 0.35) {
    // Find a hospital, its doctors and free times.
    const h = await call(user, 'hospitals near me', `/hospitals?lat=${17.7 + Math.random() * 0.1}&lng=${83.2 + Math.random() * 0.1}`);
    const hospital = h?.hospitals?.length && pick(h.hospitals.slice(0, 5));
    if (!hospital) return;
    const d = await call(user, 'doctors of a hospital', `/hospitals/${hospital.id}/doctors`);
    const doctor = d?.doctors?.length && pick(d.doctors);
    if (doctor) await call(user, 'free times of a doctor', `/doctors/${doctor.id}/slots`);
  } else if (r < 0.6) {
    await call(user, 'home: summary', '/me/summary');
    await call(user, 'home: my appointments', '/me/appointments');
  } else if (r < 0.75) {
    await call(user, 'records', '/me/records');
  } else if (r < 0.95) {
    // Book a free time (a government hospital: no payment step), then cancel so times stay free.
    const h = await call(user, 'hospitals near me', '/hospitals?type=government');
    const hospital = h?.hospitals?.length && pick(h.hospitals);
    if (!hospital) return;
    const d = await call(user, 'doctors of a hospital', `/hospitals/${hospital.id}/doctors`);
    const doctor = d?.doctors?.length && pick(d.doctors);
    if (!doctor) return;
    const s = await call(user, 'free times of a doctor', `/doctors/${doctor.id}/slots`);
    const free = s?.slots?.filter((x) => !x.is_booked) ?? [];
    if (!free.length) return;
    // 409 = someone else took the time a moment earlier: correct behaviour, not an error.
    const b = await call(user, 'book appointment', '/appointments', { method: 'POST', body: { slotId: pick(free.slice(0, 10)).id }, expect: [201, 409] });
    if (b?.appointment) await call(user, 'cancel appointment', `/appointments/${b.appointment.id}/cancel`, { method: 'POST' });
  } else {
    const a = await call(user, 'SOS: raise alert', '/emergency/alerts', {
      method: 'POST',
      body: { clientRef: `load-${user.phone}-${Date.now()}`, symptoms: codes.length ? [pick(codes)] : [], lat: 17.72 + Math.random() * 0.05, lng: 83.3 + Math.random() * 0.05, note: 'load test' },
    });
    const id = a?.alert?.id;
    if (id) await call(user, 'SOS: cancel alert', `/emergency/alerts/${id}/cancel`, { method: 'POST' });
  }
}

async function main() {
  if (!base) await startServer();
  console.log(`Load test: ${USERS} users for ${DURATION / 1000} s against ${base}${child ? ' (fresh in-memory database)' : ''}`);
  const cfg = await request(`${base}/api/emergency/config`, { method: 'GET' });
  codes = cfg.data.codes.map((c) => c.code);

  // Everyone signs in over ~10 seconds, as in a morning OPD rush.
  const users = [];
  await Promise.all(
    Array.from({ length: USERS }, async (_, i) => {
      await sleep((i / USERS) * 10_000);
      try {
        users.push(await signIn(i + 1));
      } catch (err) {
        if (i === 0) throw err;
      }
    }),
  );

  const started = Date.now();
  const end = started + DURATION;
  await Promise.all(
    users.map(async (u) => {
      while (Date.now() < end) {
        await actions(u);
        await sleep(THINK_MS * (0.5 + Math.random()));
      }
    }),
  );
  const seconds = (Date.now() - started) / 1000;

  // ---- report ----
  let total = 0;
  let errors = 0;
  const rows = [...stats].map(([name, s]) => {
    const t = s.times.sort((a, b) => a - b);
    total += t.length;
    errors += s.errors + s.noAnswer;
    return [name, t.length, s.errors, s.noAnswer, pct(t, 50), pct(t, 95), pct(t, 99), t.at(-1)].map((v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v) : v));
  });
  console.log(`\n| Request | Count | Errors | No answer | p50 ms | p95 ms | p99 ms | max ms |\n|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (const r of rows) console.log(`| ${r.join(' | ')} |`);
  console.log(`\nSigned in: ${users.filter((u) => u.token).length}/${USERS}. Requests: ${total} in ${Math.round(seconds)} s = ${(total / seconds).toFixed(1)} per second. Failed: ${errors} (${((errors / total) * 100).toFixed(2)}%).`);
  return errors / total;
}

// Never leave the test server running, even if this script crashes.
process.on('exit', () => child?.kill('SIGTERM'));
let exitCode = 0;
try {
  const errorRate = await main();
  // Fail (e.g. in CI) when more than 1% of requests fail.
  if (errorRate > 0.01) exitCode = 1;
} catch (err) {
  console.error(err.message);
  exitCode = 1;
} finally {
  child?.kill('SIGTERM');
}
process.exit(exitCode);
