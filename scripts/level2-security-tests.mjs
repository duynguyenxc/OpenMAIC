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
  const scene = JSON.parse(readFileSync('/tmp/real-scene.json','utf8'));
  const stage = JSON.parse(readFileSync('/tmp/real-stage.json','utf8'));
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
    const stage = JSON.parse(readFileSync('/tmp/real-stage.json','utf8'));
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

await pool.end();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
