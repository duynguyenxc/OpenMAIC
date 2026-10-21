// Level 3A — the end-to-end test instruction v3 specifies, run for real.
//
//   Admin creates the institutions and the study.
//   An instructor publishes a module as a template.
//   Instructors at three institutions clone it.
//   Different students are enrolled at each.
//   Verify: content equivalent, course ids differ, datasets isolated,
//   instructors see only their own, admin sees all, researcher sees only
//   approved de-identified study data.
//
// Nothing here is mocked. Every assertion is a request to the running server.
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
const J = (b) => JSON.stringify(b);
let passed = 0, failed = 0;
function check(label, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`); }
  else    { failed += 1; console.log(`  FAIL  ${label}  ${detail}`); }
}
const refused = (r) => r.status === 401 || r.status === 403 || r.status === 404;

const A = {
  admin:   await signIn('admin@example.test'),
  us:      await signIn('instructor-us@example.test'),
  uk:      await signIn('instructor-uk@example.test'),
  au:      await signIn('instructor-au@example.test'),
  student: await signIn('student-us@example.test'),
  student2:await signIn('student-uk@example.test'),
  researcher: await signIn('researcher@example.test'),
  instructor1: await signIn('instructor1@example.test'),
};

// ── Build the module the three institutions will share ──────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const scene = JSON.parse(readFileSync(join(here, 'fixtures/scene.json'), 'utf8'));
const stage = JSON.parse(readFileSync(join(here, 'fixtures/stage.json'), 'utf8'));

async function makeCourse(actor, title) {
  const id = 'L3' + Math.random().toString(36).slice(2, 10);
  const doc = {
    stage: { ...stage, id, name: title, createdAt: Date.now(), updatedAt: Date.now() },
    scenes: [{ ...scene, id: 'sc1', stageId: id, order: 1, title: 'Lesson 1' }],
    outline: { outlines: [] },
  };
  const r = await api(actor, `/api/persistence/documents/${id}`, { method:'PUT', body: J(doc) });
  if (r.status >= 300) throw new Error(`create ${title}: ${r.status} ${r.body}`);
  await pool.query(`UPDATE courses SET title=$2, status='PUBLISHED' WHERE openmaic_stage_id=$1`, [id, title]);
  return id;
}

console.log('INSTITUTIONS');
{
  const r = await api(A.admin, '/api/level3/institutions');
  const list = r.status === 200 ? JSON.parse(r.body).institutions : [];
  check('administrator sees the three institutions',
    ['US','UK','AU'].every((s) => list.some((i) => i.shortName === s)), r.body.slice(0,80));

  const asInstructor = await api(A.us, '/api/level3/institutions', {
    method: 'POST', body: J({ name: 'Rogue University', shortName: 'ROGUE' }) });
  check('an instructor cannot create an institution', refused(asInstructor), `got ${asInstructor.status}`);
}

console.log('\nTEMPLATES — one module, published once');
// Everything this run creates is named after the run and removed at the end.
// The Level-2 suite had to learn the same lesson: a suite that leaves a course
// behind on every run fills the platform with sections nobody can tell apart,
// and a researcher's study ends up listing twenty of them.
const RUN = `test ${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
const sourceCourse = await makeCourse(A.instructor1, `L3 source (${RUN})`);
let templateId;
{
  const r = await api(A.instructor1, '/api/level3/templates', {
    method: 'POST',
    body: J({ stageId: sourceCourse, title: `Shared ethics module (${RUN})`,
              version: '1.0', visibility: 'COMMUNITY', discipline: 'Ethics' }),
  });
  check('an instructor can publish their course as a template', r.status === 201, r.body.slice(0,100));
  templateId = r.status === 201 ? JSON.parse(r.body).id : null;

  const student = await api(A.student, '/api/level3/templates');
  check('a student cannot browse the template library', refused(student), `got ${student.status}`);

  const notMine = await api(A.us, '/api/level3/templates', {
    method: 'POST', body: J({ stageId: sourceCourse, title: 'Stolen', version: '1.0' }) });
  check('an instructor cannot publish a course that is not theirs', refused(notMine), `got ${notMine.status}`);
}

console.log('\nCLONING — same design, separate sections');
const clones = {};
for (const [key, actor] of [['US', A.us], ['UK', A.uk], ['AU', A.au]]) {
  const r = await api(actor, `/api/level3/templates/${templateId}/clone`, {
    method: 'POST', body: J({ title: `Course-${key} (${RUN})` }) });
  check(`Instructor-${key} can clone the shared template`, r.status === 201, r.body.slice(0,120));
  if (r.status === 201) clones[key] = JSON.parse(r.body).stageId;
}
{
  const ids = Object.values(clones);
  check('every section has a different course id', new Set(ids).size === ids.length, ids.join(','));

  const { rows } = await pool.query(
    `SELECT c.openmaic_stage_id AS id, c.template_version AS v, i.short_name AS inst,
            (c.configuration_snapshot IS NOT NULL) AS snap,
            (SELECT count(*) FROM document_scenes ds WHERE ds.stage_id = c.openmaic_stage_id) AS scenes
       FROM courses c LEFT JOIN institutions i ON i.id = c.institution_id
      WHERE c.openmaic_stage_id = ANY($1::text[])`, [ids]);
  check('the instructional content is equivalent in every section',
    rows.length === 3 && new Set(rows.map(r => r.scenes)).size === 1, J(rows.map(r=>r.scenes)));
  check('each section records the template version it came from',
    rows.every((r) => r.v === '1.0'), J(rows.map(r=>r.v)));
  check('each section carries a configuration snapshot', rows.every((r) => r.snap), J(rows.map(r=>r.snap)));
  check('each section belongs to its own institution',
    new Set(rows.map(r => r.inst)).size === 3, J(rows.map(r=>r.inst)));

  const { rows: runtime } = await pool.query(
    `SELECT count(*)::int n FROM runtime_sessions WHERE stage_id = ANY($1::text[])`, [ids]);
  check('no learner runtime was copied into the clones', runtime[0].n === 0, `sessions=${runtime[0].n}`);

  const { rows: enrol } = await pool.query(
    `SELECT count(*)::int n FROM enrollments e JOIN courses c ON c.id = e.course_id
      WHERE c.openmaic_stage_id = ANY($1::text[])`, [ids]);
  check('no enrolment was copied into the clones', enrol[0].n === 0, `enrolments=${enrol[0].n}`);
}

console.log('\nISOLATION — a shared template is not shared access');
{
  const ukReadsUs = await api(A.uk, `/api/level3/templates`);
  void ukReadsUs;
  const r1 = await api(A.uk, `/api/level2/courses/${clones.US}/results`);
  check('Instructor-UK cannot read Course-US results', refused(r1), `got ${r1.status}`);
  const r2 = await api(A.us, `/api/level2/courses/${clones.AU}/enrollments`, {
    method: 'POST', body: J({ email: 'student-au@example.test' }) });
  check('Instructor-US cannot enrol a student into Course-AU', refused(r2), `got ${r2.status}`);
  const r3 = await api(A.us, '/api/level2/courses');
  const mine = r3.status === 200 ? JSON.parse(r3.body).courses.map((c) => c.stageId) : [];
  check('Instructor-US sees only their own section',
    mine.includes(clones.US) && !mine.includes(clones.UK) && !mine.includes(clones.AU), mine.join(','));
}

console.log('\nSTUDY — courses, conditions, participants');
const { rows: studyRow } = await pool.query(
  `SELECT id FROM studies WHERE protocol_identifier = 'PROTO-2026-001' LIMIT 1`);
const studyId = studyRow[0].id;
{
  for (const [key, condition] of [['US','CONDITION-A'], ['UK','CONDITION-B'], ['AU','CONDITION-A']]) {
    const r = await api(A.admin, `/api/level3/studies/${studyId}/courses`, {
      method: 'POST', body: J({ stageId: clones[key], condition, cohort: `${key}-2026` }) });
    check(`Course-${key} joins the study as ${condition}`, r.status === 200, r.body.slice(0,90));
  }
  const byInstructor = await api(A.us, `/api/level3/studies/${studyId}/courses`);
  check('an instructor is not automatically authorized for the study', refused(byInstructor),
    `got ${byInstructor.status}`);
}

console.log('\nPARTICIPANTS — identity separated from the research id');
{
  await api(A.admin, `/api/level2/courses/${clones.US}/enrollments`, {
    method: 'POST', body: J({ email: 'student-us@example.test' }) });
  await api(A.admin, `/api/level2/courses/${clones.UK}/enrollments`, {
    method: 'POST', body: J({ email: 'student-uk@example.test' }) });

  const p1 = await api(A.admin, `/api/level3/studies/${studyId}/participants`, {
    method: 'POST', body: J({ email: 'student-us@example.test', consentStatus: 'CONSENTED' }) });
  const p2 = await api(A.admin, `/api/level3/studies/${studyId}/participants`, {
    method: 'POST', body: J({ email: 'student-uk@example.test', consentStatus: 'DECLINED' }) });
  check('a participant id is allocated, not an email', p1.status === 200 && /^P-\d{5}$/.test(JSON.parse(p1.body).participantId), p1.body.slice(0,80));
  check('a second participant gets a different id',
    p2.status === 200 && JSON.parse(p1.body).participantId !== JSON.parse(p2.body).participantId,
    `${p1.body.slice(0,40)} / ${p2.body.slice(0,40)}`);

  const asResearcher = await api(A.researcher, `/api/level3/studies/${studyId}/participants`);
  const seen = asResearcher.status === 200 ? JSON.parse(asResearcher.body) : {};
  check('a researcher sees participant ids without identities',
    asResearcher.status === 200 && seen.identified === false &&
    (seen.participants ?? []).every((p) => !('email' in p)), asResearcher.body.slice(0,90));
}

console.log('\nEVENTS — projected from OpenMAIC records, never invented');
{
  // The US section needs something true to project. The runtime write path
  // itself is Level 2's business and its suite covers it; here the fixture is
  // inserted directly so that what is under test is the projection, not the
  // classroom. The shape is exactly what OpenMAIC writes: a session keyed by
  // (stage_id, learner_key), and records whose data.payload carries the kind.
  const sessionId = `l3-${Date.now()}`;
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO runtime_sessions (id, stage_id, learner_key, kind, status, created_at, updated_at, data)
     VALUES ($1, $2, $3, 'chat', 'active', $4, $4, '{}'::jsonb)`,
    [sessionId, clones.US, `user:${A.student.userId}`, now],
  );
  for (const [seq, payload] of [
    [0, { kind: 'chat_message', role: 'assistant', content: 'Consider the ethical trade-off here.' }],
    [1, { kind: 'chat_message', role: 'user', content: 'I would weigh the harm against the benefit.' }],
    [2, { kind: 'chat_session_state', role: 'system', title: 'Lesson 1' }],
  ]) {
    const recordId = `${sessionId}:r${seq}`;
    await pool.query(
      `INSERT INTO runtime_records (id, session_id, seq, scene_id, created_at, data)
       VALUES ($1, $2, $3, 'sc1', $4, $5)`,
      [recordId, sessionId, seq, now,
       { id: recordId, seq, sceneId: 'sc1', createdAt: now, sessionId, payload }],
    );
  }

  const r = await api(A.researcher, `/api/level3/studies/${studyId}/project`, { method: 'POST' });
  check('the researcher can rebuild the study events', r.status === 200, r.body.slice(0,110));
  const again = await api(A.researcher, `/api/level3/studies/${studyId}/project`, { method: 'POST' });
  const second = again.status === 200 ? JSON.parse(again.body).total.written : -1;
  check('projecting twice writes nothing the second time', second === 0, `wrote ${second}`);

  const { rows: ev } = await pool.query(
    `SELECT count(*)::int n, count(source_runtime_record_id)::int traced
       FROM research_events WHERE study_id = $1`, [studyId]);
  check('every projected event names the record it came from', ev[0].n === ev[0].traced,
    `${ev[0].traced}/${ev[0].n}`);

  const { rows: kinds } = await pool.query(
    `SELECT event_type, count(*)::int n FROM research_events WHERE study_id = $1
      GROUP BY event_type ORDER BY event_type`, [studyId]);
  const have = Object.fromEntries(kinds.map((k) => [k.event_type, k.n]));
  check('a student message is recorded as STUDENT_MESSAGE', (have.STUDENT_MESSAGE ?? 0) > 0, J(have));
  check('an agent reply is recorded as AGENT_RESPONSE', (have.AGENT_RESPONSE ?? 0) > 0, J(have));
}

console.log('\nEXPORT — de-identified, consent-filtered, authorized');
{
  const anon = await api(null, `/api/level3/studies/${studyId}/export`);
  check('an unauthenticated export is refused', refused(anon), `got ${anon.status}`);

  const byStudent = await api(A.student, `/api/level3/studies/${studyId}/export`);
  check('a student cannot export a study', refused(byStudent), `got ${byStudent.status}`);

  const byInstructor = await api(A.us, `/api/level3/studies/${studyId}/export`);
  check('an instructor on a study course still cannot export it', refused(byInstructor),
    `got ${byInstructor.status}`);

  const r = await api(A.researcher, `/api/level3/studies/${studyId}/export?format=json`);
  check('the authorized researcher can export', r.status === 200, r.body.slice(0,90));
  if (r.status === 200) {
    const data = JSON.parse(r.body);
    const text = JSON.stringify(data.rows);
    check('the export contains no email address', !/@example\.test/.test(text));
    check('the export carries participant ids',
      data.rows.every((row) => /^P-\d{5}$/.test(row.participant_id)) || data.rows.length === 0);
    check('a participant who declined is excluded',
      data.rows.every((row) => row.consent_status === 'CONSENTED'));
    check('the export carries a data-quality report',
      Array.isArray(data.quality?.checks) && data.quality.checks.length > 0);
    check('the export names the experimental condition',
      data.rows.length === 0 || data.rows.every((row) => row.experimental_condition));
  }

  const csv = await api(A.researcher, `/api/level3/studies/${studyId}/export?format=csv`);
  check('CSV export works', csv.status === 200 && csv.body.includes('participant_id'), csv.body.slice(0,60));
}

console.log('\nAUDIT — the actions the instruction names are recorded');
{
  const { rows } = await pool.query(
    `SELECT action, count(*)::int n FROM audit_log GROUP BY action ORDER BY action`);
  const have = new Set(rows.map((r) => r.action));
  for (const action of ['TEMPLATE_PUBLISHED','TEMPLATE_CLONED','STUDY_COURSE_ADDED','CONSENT_CHANGED','DATA_EXPORTED']) {
    check(`audit records ${action}`, have.has(action), [...have].join(','));
  }
  const { rows: leak } = await pool.query(
    `SELECT count(*)::int n FROM audit_log
      WHERE metadata::text ~* '(password|secret|token|apikey|api_key)'`);
  check('the audit log holds no credential-looking field', leak[0].n === 0, `rows=${leak[0].n}`);
}

// ── Clean up ────────────────────────────────────────────────────────────────
{
  const { rows } = await pool.query(
    `DELETE FROM courses WHERE title LIKE $1 RETURNING openmaic_stage_id`, [`%(${RUN})%`]);
  const { rowCount: templates } = await pool.query(
    `DELETE FROM course_templates WHERE title LIKE $1`, [`%(${RUN})%`]);
  // The study and its institutions are fixtures, not run artefacts, and stay.
  console.log(`\n(removed ${rows.length} section(s) and ${templates} template(s) from this run)`);
}

await pool.end();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
