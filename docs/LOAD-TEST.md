# Load test

`npm run loadtest` starts a fresh server with an in-memory database and
simulates many people using the app at once. Each simulated person signs in
with their own mobile number, then keeps going through this mix, pausing
about 1 second between actions:

| Share | What they do |
|---:|---|
| 35 % | find hospitals near them → a hospital's doctors → a doctor's free times |
| 25 % | open Home (summary + appointments) |
| 15 % | open Records |
| 20 % | book a free time at a government hospital, then cancel it |
| 5 % | raise an SOS with a location and symptom, then cancel it |

Options: `--users 300 --duration 120 --think 1000`. Point it at a staging
server with `--url https://staging.example.org` (it needs `OTP_DEV_ECHO=true`
to sign in, so it cannot be run against production). It exits with an error
when more than 1 % of requests fail.

## Results (27 Sept 2026)

One MacBook (Apple M1, 8 cores) ran both the load test and the server. The server
used the built-in PGlite database (PostgreSQL inside the Node process), so the
server uses **one CPU core** for everything, database included.

| People at once | Requests / s | Typical answer (p50) | Slowest 5 % (p95) | Failed |
|---:|---:|---:|---:|---:|
| 100 | 274 | 3–8 ms | 11–17 ms | 0 |
| 300 | 625 | ~105 ms | 160–235 ms | 0 |
| 1000 | 696 | ~1 s | 1.1–1.6 s | 200 of 44,568 (0.45 %): no answer within 30 s, 6 of them SOS |

Every sign-in, booking and SOS was handled correctly up to 300 people. At
1000 the server's one core was fully busy (100 % CPU): answers slowed to about
a second and a few requests queued for more than 30 s.

### What this means for a pilot

The simulated people act about every second, far busier than real patients (one
action every 10–30 s). 300 of them are roughly **3,000–9,000 real people using
the app at the same moment**. A PHC area has 30,000–50,000 residents, of whom a
few hundred use the app in a busy hour. One server is plenty for the pilot.

### Before a city-wide rollout

- Repeat this on the staging server with real PostgreSQL (`--url`). With the
  database in its own process, the Node server has its core to itself and
  should do better than here.
- Run 2+ app instances behind the load balancer (see "More than one server" in
  [DEPLOY.md](DEPLOY.md)).
- Under overload, an SOS waits in the same queue as browsing. Consider a
  separate instance, or a priority queue, just for `/api/emergency` and
  `/api/gateway`, so emergencies stay fast even when the rest is busy.
