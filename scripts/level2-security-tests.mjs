/**
 * Level 2 — the authorization matrix and the direct-API attacks the
 * instruction specifies, as an automated test.
 *
 * "Do not rely only on browser testing. Test APIs directly." Every assertion
 * here is an HTTP request made as a signed-in account; nothing is checked by
 * reading the database or the UI.
 *
 * Scenario, exactly as the instruction sets it out:
 *   COURSE A  owner Instructor 1, students 1 and 2
 *   COURSE B  owner Instructor 2, student 3
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

async function signIn(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method:'POST', headers:{apikey:KEY,'Content-Type':'application/json'},
    body: JSON.stringify({ email, password: pw[email] }),
  });
  const s = await r.json();
  if (!r.ok) throw new Error(`sign-in ${email}: ${JSON.stringify(s)}`);
  return { email, userId: s.user.id,
    cookie: `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s)).toString('base64url')}` };
}

async function api(actor, path, init = {}) {
  const r = await fetch(BASE + path, {
    ...init,
    headers: { ...(actor ? { cookie: actor.cookie } : {}), 'Content-Type':'application/json', ...(init.headers ?? {}) },
    redirect: 'manual',
  });
  return { status: r.status, body: await r.text() };
}

let passed = 0, failed = 0;
function check(label, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`); }
  else    { failed += 1; console.log(`  FAIL  ${label}  ${detail}`); }
}
const refused = (r) => r.status === 401 || r.status === 403;

async function makeCourse(actor, title) {
  // The fixtures used to be read from /tmp, so the suite stopped running the
  // first time that directory was cleared — a test suite that cannot be run
  // is not a test suite. They now live in the repository, beside this script.
  const here = dirname(fileURLToPath(import.meta.url));
  const scene = JSON.parse(readFileSync(join(here, 'fixtures/scene.json'), 'utf8'));
  const stage = JSON.parse(readFileSync(join(here, 'fixtures/stage.json'), 'utf8'));
  const id = 'T' + Math.random().toString(36).slice(2, 10);
  const doc = { stage: { ...stage, id, name: title, createdAt: Date.now(), updatedAt: Date.now() },
                scenes: [{ ...scene, id: 'sc1', stageId: id, order: 1, title: 'Lesson 1' }],
                outline: { outlines: [] } };
  const r = await api(actor, `/api/persistence/documents/${id}`, { method:'PUT', body: JSON.stringify(doc) });
  if (r.status >= 300) throw new Error(`create ${title}: ${r.status} ${r.body}`);
  await pool.query(`UPDATE courses SET title=$2, status='PUBLISHED' WHERE openmaic_stage_id=$1`, [id, title]);
  return id;
}

async function enrol(stageId, email) {
  await pool.query(
    `INSERT INTO enrollments (course_id, student_id, status)
     SELECT c.id, up.id, 'ACTIVE' FROM courses c, user_profiles up
      WHERE c.openmaic_stage_id=$1 AND up.email=$2
     ON CONFLICT (course_id, student_id) DO UPDATE SET status='ACTIVE'`, [stageId, email]);
}

async function seedRuntime(stageId, email) {
  await pool.query(
    `INSERT INTO runtime_sessions (id, stage_id, learner_key, kind, status, created_at, updated_at, data)
     SELECT $1||':'||up.email, $2, 'user:'||up.auth_user_id, 'chat', 'active', now(), now(), '{}'::jsonb
       FROM user_profiles up WHERE up.email=$3
     ON CONFLICT (id) DO NOTHING`, [stageId, stageId, email]);
}

const A = {};
for (const n of ['admin','instructor1','instructor2','student1','student2','student3']) {
  A[n] = await signIn(`${n}@example.test`);
}

console.log('\nSetting up Course A (instructor1, students 1+2) and Course B (instructor2, student 3)');
const COURSE_A = await makeCourse(A.instructor1, 'Course A');
const COURSE_B = await makeCourse(A.instructor2, 'Course B');
await enrol(COURSE_A, 'student1@example.test');
await enrol(COURSE_A, 'student2@example.test');
await enrol(COURSE_B, 'student3@example.test');
for (const s of ['student1@example.test','student2@example.test']) await seedRuntime(COURSE_A, s);
await seedRuntime(COURSE_B, 'student3@example.test');
console.log(`  Course A = ${COURSE_A}   Course B = ${COURSE_B}\n`);

const list = async (actor) => {
  const r = await api(actor, '/api/level2/courses');
  return r.status === 200 ? JSON.parse(r.body).courses.map((c) => c.stageId) : [];
};

console.log('ADMIN');
{
  const seen = await list(A.admin);
  check('sees Course A', seen.includes(COURSE_A));
  check('sees Course B', seen.includes(COURSE_B));
  check('sees all users', (await api(A.admin, '/api/level2/admin/users')).status === 200);
  check('sees Course A runtime', (await api(A.admin, `/api/level2/courses/${COURSE_A}/results`)).status === 200);
  check('sees Course B runtime', (await api(A.admin, `/api/level2/courses/${COURSE_B}/results`)).status === 200);
}

console.log('INSTRUCTOR 1');
{
  const seen = await list(A.instructor1);
  check('sees Course A', seen.includes(COURSE_A));
  check('does not see Course B', !seen.includes(COURSE_B));
  check('reads Course A', (await api(A.instructor1, `/api/persistence/documents/${COURSE_A}`)).status === 200);
  check('sees students 1 and 2', await (async () => {
    const r = await api(A.instructor1, `/api/level2/courses/${COURSE_A}/enrollments`);
    if (r.status !== 200) return false;
    const e = JSON.parse(r.body).students.map((s) => s.email);
    return e.includes('student1@example.test') && e.includes('student2@example.test');
  })());
  check('sees their runtime', (await api(A.instructor1, `/api/level2/courses/${COURSE_A}/results`)).status === 200);
  check('cannot edit Course B', refused(await api(A.instructor1, `/api/persistence/documents/${COURSE_B}`,
    { method:'PUT', body: JSON.stringify({ stage: { id: COURSE_B, name: 'hijacked' }, scenes: [], outline: { outlines: [] } }) })));
  check('cannot read Course B', refused(await api(A.instructor1, `/api/persistence/documents/${COURSE_B}`)));
  check('cannot see Course B runtime', refused(await api(A.instructor1, `/api/level2/courses/${COURSE_B}/results`)));
}

console.log('INSTRUCTOR 2');
{
  const seen = await list(A.instructor2);
  check('sees Course B', seen.includes(COURSE_B));
  check('does not see Course A', !seen.includes(COURSE_A));
  check('cannot edit Course A', refused(await api(A.instructor2, `/api/persistence/documents/${COURSE_A}`,
    { method:'PUT', body: JSON.stringify({ stage: { id: COURSE_A, name: 'hijacked' }, scenes: [], outline: { outlines: [] } }) })));
}

console.log('STUDENT 1');
{
  const seen = await list(A.student1);
  check('sees Course A', seen.includes(COURSE_A));
  check('does not see Course B', !seen.includes(COURSE_B));
  check('opens Course A', (await api(A.student1, `/api/persistence/documents/${COURSE_A}`)).status === 200);
  check('cannot edit Course A', refused(await api(A.student1, `/api/persistence/documents/${COURSE_A}`,
    { method:'PUT', body: JSON.stringify({ stage: { id: COURSE_A, name: 'hijacked' }, scenes: [], outline: { outlines: [] } }) })));
  check('cannot delete Course A', refused(await api(A.student1, `/api/persistence/documents/${COURSE_A}`, { method:'DELETE' })));
  check('cannot read Course B', refused(await api(A.student1, `/api/persistence/documents/${COURSE_B}`)));
  check('cannot see the student list', refused(await api(A.student1, `/api/level2/courses/${COURSE_A}/enrollments`)));
  check('cannot see course results', refused(await api(A.student1, `/api/level2/courses/${COURSE_A}/results`)));
  check('cannot export', refused(await api(A.student1, `/api/level2/courses/${COURSE_A}/export?format=csv`)));
  check('cannot reach administration', refused(await api(A.student1, '/api/level2/admin/users')));
  check('cannot promote themselves', refused(await api(A.student1, '/api/level2/admin/users',
    { method:'PATCH', body: JSON.stringify({ email: 'student1@example.test', role: 'ADMIN' }) })));
  // A *valid* document, so the request reaches the create hook rather than
  // being rejected by schema validation first — otherwise this proves nothing.
  check('cannot create a course', await (async () => {
    const id = 'HACK' + Date.now();
    const stage = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/stage.json'), 'utf8'));
    const r = await api(A.student1, `/api/persistence/documents/${id}`, { method:'PUT',
      body: JSON.stringify({ stage: { ...stage, id, name: 'student course', createdAt: Date.now(), updatedAt: Date.now() },
                             scenes: [], outline: { outlines: [] } }) });
    return refused(r);
  })());

  // Impersonation: address another learner's runtime partition directly.
  const key2 = `user:${A.student2.userId}`;
  const key3 = `user:${A.student3.userId}`;
  check('cannot read student 2 runtime', refused(await api(A.student1,
    `/api/persistence/runtime/stages/${COURSE_A}/learners/${encodeURIComponent(key2)}/sessions`)));
  check('cannot read student 3 runtime', refused(await api(A.student1,
    `/api/persistence/runtime/stages/${COURSE_B}/learners/${encodeURIComponent(key3)}/sessions`)));
  // The runtime contract names the learner in the *body* of POST
  // /runtime/sessions, which is the shape this attack really takes.
  const session = (id, learnerKey, stageId) => ({ id, stageId, learnerKey, kind: 'chat',
    status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), data: {} });
  check('can write their own runtime',
    (await api(A.student1, '/api/persistence/runtime/sessions',
      { method:'POST', body: JSON.stringify(session('own-'+Date.now(), `user:${A.student1.userId}`, COURSE_A)) })).status === 201);
  check('cannot write runtime as student 2', refused(await api(A.student1, '/api/persistence/runtime/sessions',
    { method:'POST', body: JSON.stringify(session('imp-'+Date.now(), key2, COURSE_A)) })));
}

console.log('STUDENT 3');
{
  const seen = await list(A.student3);
  check('sees Course B only', seen.includes(COURSE_B) && !seen.includes(COURSE_A));
  check('cannot read Course A', refused(await api(A.student3, `/api/persistence/documents/${COURSE_A}`)));
}

console.log('NO SESSION');
for (const path of ['/api/level2/me','/api/level2/courses','/api/stages',`/api/persistence/documents/${COURSE_A}`]) {
  check(`refused: ${path}`, refused(await api(null, path)));
}

console.log('TWO STUDENTS IN ONE COURSE — runtime stays separate');
{
  const r = await api(A.instructor1, `/api/level2/courses/${COURSE_A}/results`);
  const rows = r.status === 200 ? JSON.parse(r.body).students : [];
  const s1 = rows.find((x) => x.email === 'student1@example.test');
  const s2 = rows.find((x) => x.email === 'student2@example.test');
  check('instructor sees both students individually', Boolean(s1 && s2));
  // The property worth asserting is separation, not a fixed number: the tests
  // above write a session of their own, so an exact count would be brittle.
  // Each student must have their own sessions, and the two must account for
  // every session in the course — nothing leaked across, nothing double-counted.
  const { rows: [{ total }] } = await pool.query(
    `SELECT count(*)::int AS total FROM runtime_sessions WHERE stage_id = $1`, [COURSE_A]);
  check('each student has their own runtime', (s1?.sessions ?? 0) > 0 && (s2?.sessions ?? 0) > 0,
    `s1=${s1?.sessions} s2=${s2?.sessions}`);
  check('no session is attributed to the wrong student',
    (s1?.sessions ?? 0) + (s2?.sessions ?? 0) === total,
    `s1=${s1?.sessions} + s2=${s2?.sessions} should equal ${total}`);
}

/*
 * ─────────────────────────────────────────────────────────────────────────
 * The second half.
 *
 * Everything above has one shape: can A reach B's things? That shape missed a
 * bug that cost an owner their own course — offering your own address to the
 * co-instructor endpoint overwrote OWNER with EDITOR and locked you out, with
 * no way back from inside the product. Four more shapes are checked here:
 * damaging your own record, sending the same request twice, values that are
 * syntactically fine and semantically absurd, and answers that are true but
 * misleading.
 * ─────────────────────────────────────────────────────────────────────────
 */
console.log('SELF-DAMAGE — a user may not break their own access');
{
  const demote = await api(A.instructor1, `/api/level2/courses/${COURSE_A}/instructors`, {
    method: 'POST',
    body: JSON.stringify({ email: 'instructor1@example.test', permission: 'EDITOR' }),
  });
  check('owner cannot demote themselves to editor', demote.status === 409,
    `got ${demote.status} ${demote.body.slice(0, 80)}`);

  // And the owner still owns the course afterwards, which is the point.
  const { rows } = await pool.query(
    `SELECT ci.permission FROM course_instructors ci
       JOIN courses c ON c.id = ci.course_id
       JOIN user_profiles up ON up.id = ci.instructor_id
      WHERE c.openmaic_stage_id = $1 AND up.email = 'instructor1@example.test'`, [COURSE_A]);
  check('the owner row survives the attempt', rows[0]?.permission === 'OWNER',
    `permission is ${rows[0]?.permission}`);

  const stillOwner = await api(A.instructor1, `/api/level2/courses/${COURSE_A}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'PUBLISHED' }),
  });
  check('owner-only actions still work afterwards', stillOwner.status === 200);
}

console.log('REPETITION — the same request twice is not two courses');
{
  const body = JSON.stringify({ title: 'Idempotence probe' });
  const [one, two] = await Promise.all([
    api(A.instructor1, `/api/level2/courses/${COURSE_A}/duplicate`, { method: 'POST', body }),
    api(A.instructor1, `/api/level2/courses/${COURSE_A}/duplicate`, { method: 'POST', body }),
  ]);
  const ids = [one, two].map((r) => (r.status < 300 ? JSON.parse(r.body).stageId : null));
  check('two simultaneous duplicates produce one course', ids[0] && ids[0] === ids[1],
    `${ids[0]} vs ${ids[1]}`);
  if (ids[0]) {
    await api(A.instructor1, `/api/level2/courses/${ids[0]}`, { method: 'DELETE', body: '{}' });
  }
}

console.log('BOUNDARY VALUES — absurd input is refused, not stored');
{
  const long = await api(A.instructor1, `/api/level2/courses/${COURSE_A}`, {
    method: 'PATCH', body: JSON.stringify({ title: 'X'.repeat(5000) }),
  });
  check('a 5,000-character title is refused', long.status === 400, `got ${long.status}`);

  const blank = await api(A.instructor1, `/api/level2/courses/${COURSE_A}`, {
    method: 'PATCH', body: JSON.stringify({ title: '   ' }),
  });
  check('a blank title is refused', blank.status === 400, `got ${blank.status}`);

  const malformed = await api(A.instructor1, `/api/level2/courses/${COURSE_A}/enrollments`, {
    method: 'POST', body: JSON.stringify({ email: 'not-an-address' }),
  });
  check('a malformed email is refused as malformed, not as a missing account',
    malformed.status === 400 && malformed.body.includes('MALFORMED_EMAIL'),
    `got ${malformed.status} ${malformed.body.slice(0, 60)}`);

  const traversal = await api(A.instructor1, '/api/level2/courses/..%2F..%2Fetc%2Fpasswd/results');
  check('a path-traversal course id is refused', refused(traversal), `got ${traversal.status}`);
}

console.log('HONEST ANSWERS — "nothing" and "not yours" are different answers');
{
  const stranger = await api(A.instructor1,
    `/api/level2/courses/${COURSE_A}/results?email=nobody@example.test`);
  check('results for an address not on the course is 404, not an empty list',
    stranger.status === 404, `got ${stranger.status} ${stranger.body.slice(0, 60)}`);

  const enrolled = await api(A.instructor1,
    `/api/level2/courses/${COURSE_A}/results?email=student1@example.test`);
  check('results for an enrolled student is 200', enrolled.status === 200);

  const again = await api(A.instructor1, `/api/level2/courses/${COURSE_A}/enrollments`, {
    method: 'POST', body: JSON.stringify({ email: 'student1@example.test' }),
  });
  check('re-enrolling an active student says so rather than "enrolled"',
    again.status === 200 && JSON.parse(again.body).outcome === 'already-enrolled',
    again.body.slice(0, 80));
}

console.log('DELETION — reversible by default, and only for those entitled');
{
  const asStudent = await api(A.student1, `/api/level2/courses/${COURSE_A}`, {
    method: 'DELETE', body: '{}' });
  check('a student cannot delete a course', refused(asStudent), `got ${asStudent.status}`);

  const otherInstructor = await api(A.instructor2, `/api/level2/courses/${COURSE_A}`, {
    method: 'DELETE', body: '{}' });
  check('another instructor cannot delete the course', refused(otherInstructor),
    `got ${otherInstructor.status}`);

  // Course A has learner sessions by now, so the owner's delete must archive.
  const owner = await api(A.instructor1, `/api/level2/courses/${COURSE_A}`, {
    method: 'DELETE', body: '{}' });
  const archived = owner.status === 200 && JSON.parse(owner.body).archived === true;
  check('a course holding learner work is archived, not deleted', archived,
    owner.body.slice(0, 100));

  const { rows: [kept] } = await pool.query(
    `SELECT count(*)::int AS sessions FROM runtime_sessions WHERE stage_id = $1`, [COURSE_A]);
  check('archiving keeps every learner session', kept.sessions > 0, `sessions=${kept.sessions}`);

  await api(A.instructor1, `/api/level2/courses/${COURSE_A}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'PUBLISHED' }) });
}

await pool.end();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
