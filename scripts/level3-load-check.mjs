// Level 3 — concurrency measurement.
//
//   "Simulate reasonable concurrent use. Measure: page response; AI request
//    latency; database load; runtime-record writes; file upload behavior.
//    Identify practical limits of the chosen free/low-cost hosting.
//    Do not assume prototype hosting is suitable for hundreds of concurrent
//    users."
//
// So this measures, and then says what the numbers mean. It is deliberately
// modest: a handful of simulated students, because the honest finding is the
// shape of the curve and the first thing that breaks, not a big number.
//
//   BASE_URL=https://openmaic-level2.vercel.app node scripts/level3-load-check.mjs
//   CONCURRENCY=10 ROUNDS=3 node scripts/level3-load-check.mjs
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trimStart().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^"|"$/g,'')]}));
const pw = Object.fromEntries(readFileSync('.env.level2-test-accounts','utf8').split('\n')
  .filter(l=>l.includes('@')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));

const SUPA = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const KEY  = env.SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const REF  = new URL(SUPA).hostname.split('.')[0];
// Defaults to the local server on purpose. Pointing a burst at the live
// deployment triggers the host's own bot mitigation — measured on 22 October
// 2026, when eight simultaneous requests from one address earned an
// `x-vercel-mitigated: challenge` for every subsequent call from it, including
// the automated suites. The site stayed perfectly usable in a browser; what
// broke was scripted access from one IP. Measure locally unless you mean to
// provoke that, and expect it when you do.
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);
const ROUNDS = Number(process.env.ROUNDS ?? 3);
// A small pool on purpose. The session pooler this platform uses caps at
// fifteen clients in total, shared with the application, so a measuring tool
// that opens eight of its own is measuring itself.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 3 });
let poolExhausted = 0;

async function signIn(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method:'POST', headers:{apikey:KEY,'Content-Type':'application/json'},
    body: JSON.stringify({ email, password: pw[email] }) });
  const s = await r.json();
  if (!r.ok) throw new Error(`sign-in ${email}: ${JSON.stringify(s)}`);
  return { cookie: `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s)).toString('base64url')}`,
           userId: s.user.id };
}

/** Percentiles, because a mean hides the slow tail that users actually feel. */
function stats(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    n: sorted.length,
    min: Math.round(sorted[0]),
    median: Math.round(at(50)),
    p90: Math.round(at(90)),
    max: Math.round(sorted[sorted.length - 1]),
  };
}

let mitigated = 0;

async function timed(fn) {
  const t0 = performance.now();
  try {
    const ok = await fn();
    return { ms: performance.now() - t0, ok };
  } catch (error) {
    // Connection exhaustion is a finding, not a crash. It is *the* finding on
    // this hosting, and it deserves to be counted and named rather than to end
    // the run with a stack trace.
    if (String(error).includes('EMAXCONNSESSION') || String(error).includes('max clients')) {
      poolExhausted += 1;
    }
    return { ms: performance.now() - t0, ok: false };
  }
}

/**
 * A refusal by the host's edge protection is not the application failing, and
 * counting it as one would turn a hosting fact into a false bug report.
 */
async function hostRefused(res) {
  if (res.headers.get('x-vercel-mitigated') || res.headers.get('x-vercel-challenge-token')) {
    mitigated += 1;
    return true;
  }
  return false;
}

async function burst(label, make) {
  const samples = [];
  let failures = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => timed(() => make(i))),
    );
    for (const r of results) {
      samples.push(r.ms);
      if (!r.ok) failures += 1;
    }
  }
  const s = stats(samples);
  console.log(
    `  ${label.padEnd(34)} median ${String(s.median).padStart(5)} ms   ` +
    `p90 ${String(s.p90).padStart(5)} ms   max ${String(s.max).padStart(6)} ms   ` +
    `${failures ? `${failures}/${s.n} FAILED` : `${s.n}/${s.n} ok`}`,
  );
  return { label, ...s, failures };
}

console.log(`Target: ${BASE}`);
console.log(`${CONCURRENCY} concurrent × ${ROUNDS} rounds\n`);

const student = await signIn('student1@example.test');
const instructor = await signIn('instructor1@example.test');
const findings = [];

console.log('PAGE RESPONSE');
findings.push(await burst('sign-in page (unauthenticated)', () =>
  fetch(`${BASE}/platform/login`).then(async (r) => r.ok || (await hostRefused(r)))));
findings.push(await burst('student dashboard data', () =>
  fetch(`${BASE}/api/level2/courses`, { headers: { cookie: student.cookie } })
    .then(async (r) => r.ok || (await hostRefused(r)))));
findings.push(await burst('identity check (/me)', () =>
  fetch(`${BASE}/api/level2/me`, { headers: { cookie: student.cookie } })
    .then(async (r) => r.ok || (await hostRefused(r)))));

console.log('\nDATABASE');
findings.push(await burst('course results (joins + counts)', async () => {
  const { rows } = await pool.query(
    `SELECT openmaic_stage_id FROM courses WHERE status = 'PUBLISHED' LIMIT 1`);
  if (!rows[0]) return true;
  const r = await fetch(`${BASE}/api/level2/courses/${rows[0].openmaic_stage_id}/results`,
    { headers: { cookie: instructor.cookie } });
  return r.ok || r.status === 403;
}));
findings.push(await burst('direct query round trip', () =>
  pool.query('SELECT 1').then(() => true)));

console.log('\nRUNTIME-RECORD WRITES');
{
  const { rows } = await pool.query(
    `SELECT openmaic_stage_id AS id FROM courses WHERE status = 'PUBLISHED' LIMIT 1`);
  const stageId = rows[0]?.id;
  findings.push(await burst('runtime session write', async (i) => {
    if (!stageId) return true;
    const id = `load-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
    await pool.query(
      `INSERT INTO runtime_sessions (id, stage_id, learner_key, kind, status, created_at, updated_at, data)
       VALUES ($1,$2,$3,'chat','active',$4,$4,'{}'::jsonb)`,
      [id, stageId, `user:${student.userId}`, new Date().toISOString()]);
    await pool.query(`DELETE FROM runtime_sessions WHERE id = $1`, [id]);
    return true;
  }));
}

console.log('\nFILE UPLOAD');
{
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  // A refused upload still exercises the whole request path — body parsing,
  // auth, validation — without leaving rows behind on a live deployment.
  findings.push(await burst('upload request path (refused type)', async () => {
    const form = new FormData();
    form.set('stageId', 'does-not-exist'); form.set('activityId', 'sc1');
    form.set('kind', 'HANDWRITTEN_IMAGE');
    form.set('file', new File([PNG], 'p.csv', { type: 'text/csv' }));
    const r = await fetch(`${BASE}/api/level3/responses/media`,
      { method: 'POST', headers: { cookie: student.cookie }, body: form });
    return r.status === 400 || r.status === 404 || r.status === 403;
  }));
}

console.log('\nAI LATENCY');
console.log(`  ${'(measured in the 3B and 3C suites)'.padEnd(34)} assessment and feedback are the only`);
console.log(`  ${''.padEnd(34)} calls here counted in seconds`);

console.log('\n── What these numbers mean ─────────────────────────────────');
const slowest = findings.filter((f) => f).sort((a, b) => b.p90 - a.p90)[0];
const anyFailures = findings.some((f) => f && f.failures > 0);
console.log(`  Slowest at p90: ${slowest.label} (${slowest.p90} ms)`);
console.log(`  Failures under load: ${anyFailures ? 'YES — see above' : 'none at this concurrency'}`);
if (poolExhausted > 0) {
  console.log(`\n  THE LIMIT, NAMED: the database pool was exhausted ${poolExhausted} time(s).`);
  console.log('  Supabase\'s session-mode pooler caps at 15 clients in total, shared between');
  console.log('  the application and anything else connecting. That is the first thing to');
  console.log('  break here — before the host\'s edge, before any model rate limit.');
}
if (mitigated > 0) {
  console.log(`  Host edge protection answered ${mitigated} request(s) with a challenge.`);
  console.log('  That is the hosting refusing a burst from one address, not the application');
  console.log('  failing. A browser solves the challenge; a script does not.');
}
console.log(`
  Measured at ${CONCURRENCY} concurrent requests, which is a seminar, not a cohort.
  Nothing here establishes behaviour at a hundred, and the instruction is
  explicit that prototype hosting must not be assumed suitable for hundreds.
  The limits to expect first, in order: Supabase's pooled connection count,
  Vercel's function concurrency on the free plan, and model-provider rate
  limits on assessment and feedback — which are the only calls here measured
  in seconds rather than milliseconds.`);

await pool.end();
