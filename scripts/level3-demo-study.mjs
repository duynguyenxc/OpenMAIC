// Level 3A — the worked example instruction v3 asks to be delivered:
// "example multi-institution study; example research export".
//
// Unlike the test suite, this builds a demo that STAYS: one module published
// as a template and cloned into a section at each of three institutions, two
// experimental conditions, a consented participant with real recorded events,
// and one participant who declined so the consent filter can be seen working.
//
// Safe to run again: everything is addressed by stable names and reused.
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
    body: JSON.stringify({ email, password: pw[email] }) });
  const s = await r.json();
  if (!r.ok) throw new Error(`sign-in ${email}: ${JSON.stringify(s)}`);
  return { email, userId: s.user.id,
    cookie: `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s)).toString('base64url')}` };
}
async function api(actor, path, init = {}) {
  const r = await fetch(BASE + path, { ...init,
    headers: { ...(actor ? { cookie: actor.cookie } : {}), 'Content-Type':'application/json', ...(init.headers ?? {}) },
    redirect: 'manual' });
  return { status: r.status, body: await r.text() };
}
const J = JSON.stringify;

const A = {
  admin: await signIn('admin@example.test'),
  owner: await signIn('instructor1@example.test'),
  us: await signIn('instructor-us@example.test'),
  uk: await signIn('instructor-uk@example.test'),
  au: await signIn('instructor-au@example.test'),
  studentUs: await signIn('student-us@example.test'),
  studentUk: await signIn('student-uk@example.test'),
};

const TEMPLATE = 'Demo module — Ethical decision making';
const here = dirname(fileURLToPath(import.meta.url));
const scene = JSON.parse(readFileSync(join(here, 'fixtures/scene.json'), 'utf8'));
const stage = JSON.parse(readFileSync(join(here, 'fixtures/stage.json'), 'utf8'));

// ── a course to publish from ────────────────────────────────────────────────
let { rows: src } = await pool.query(
  `SELECT openmaic_stage_id AS id FROM courses WHERE title = $1`, ['Demo module source']);
let sourceId = src[0]?.id;
if (!sourceId) {
  sourceId = 'DM' + Math.random().toString(36).slice(2, 10);
  const doc = { stage: { ...stage, id: sourceId, name: 'Demo module source', createdAt: Date.now(), updatedAt: Date.now() },
                scenes: [{ ...scene, id: 'sc1', stageId: sourceId, order: 1, title: 'Lesson 1' }],
                outline: { outlines: [] } };
  const r = await api(A.owner, `/api/persistence/documents/${sourceId}`, { method:'PUT', body: J(doc) });
  if (r.status >= 300) throw new Error(`source course: ${r.status} ${r.body}`);
  await pool.query(`UPDATE courses SET title='Demo module source', status='PUBLISHED' WHERE openmaic_stage_id=$1`, [sourceId]);
}
console.log(`source course   ${sourceId}`);

// ── published once, at version 1.0 ──────────────────────────────────────────
let { rows: tpl } = await pool.query(`SELECT id FROM course_templates WHERE title = $1`, [TEMPLATE]);
let templateId = tpl[0]?.id;
if (!templateId) {
  const r = await api(A.owner, '/api/level3/templates', { method:'POST',
    body: J({ stageId: sourceId, title: TEMPLATE, version: '1.0', visibility: 'COMMUNITY',
              discipline: 'Ethics',
              description: 'One instructional design, run at three institutions under two agent conditions.' }) });
  if (r.status !== 201) throw new Error(`publish template: ${r.status} ${r.body}`);
  templateId = JSON.parse(r.body).id;
}
console.log(`template        ${templateId}  "${TEMPLATE}" v1.0`);

// ── one section per institution ─────────────────────────────────────────────
const sections = {};
for (const [key, actor] of [['US', A.us], ['UK', A.uk], ['AU', A.au]]) {
  const title = `Course-${key} — Ethical decision making`;
  const { rows } = await pool.query(`SELECT openmaic_stage_id AS id FROM courses WHERE title = $1`, [title]);
  if (rows[0]) { sections[key] = rows[0].id; continue; }
  const r = await api(actor, `/api/level3/templates/${templateId}/clone`, { method:'POST', body: J({ title }) });
  if (r.status !== 201) throw new Error(`clone ${key}: ${r.status} ${r.body}`);
  sections[key] = JSON.parse(r.body).stageId;
  await pool.query(`UPDATE courses SET status='PUBLISHED' WHERE openmaic_stage_id=$1`, [sections[key]]);
}
console.log(`sections        ${Object.entries(sections).map(([k,v])=>`${k}=${v}`).join('  ')}`);

// ── the study, its conditions, its participants ─────────────────────────────
const { rows: st } = await pool.query(
  `SELECT id FROM studies WHERE protocol_identifier = 'PROTO-2026-001'`);
const studyId = st[0].id;
for (const [key, condition] of [['US','CONDITION-A'], ['UK','CONDITION-B'], ['AU','CONDITION-A']]) {
  await api(A.admin, `/api/level3/studies/${studyId}/courses`, { method:'POST',
    body: J({ stageId: sections[key], condition, cohort: `${key}-2026` }) });
}
await api(A.admin, `/api/level2/courses/${sections.US}/enrollments`, { method:'POST', body: J({ email:'student-us@example.test' }) });
await api(A.admin, `/api/level2/courses/${sections.UK}/enrollments`, { method:'POST', body: J({ email:'student-uk@example.test' }) });
await api(A.admin, `/api/level3/studies/${studyId}/participants`, { method:'POST',
  body: J({ email: 'student-us@example.test', consentStatus: 'CONSENTED' }) });
await api(A.admin, `/api/level3/studies/${studyId}/participants`, { method:'POST',
  body: J({ email: 'student-uk@example.test', consentStatus: 'DECLINED' }) });
console.log(`study           ${studyId}  CONDITION-A x2, CONDITION-B x1`);

// ── something true to project ───────────────────────────────────────────────
const { rows: existingSessions } = await pool.query(
  `SELECT count(*)::int n FROM runtime_sessions WHERE stage_id = $1`, [sections.US]);
if (existingSessions[0].n === 0) {
  const sessionId = `demo-${Date.now()}`;
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO runtime_sessions (id, stage_id, learner_key, kind, status, created_at, updated_at, data)
     VALUES ($1,$2,$3,'chat','active',$4,$4,'{}'::jsonb)`,
    [sessionId, sections.US, `user:${A.studentUs.userId}`, now]);
  const turns = [
    { kind:'chat_message', role:'assistant', content:'Consider who is harmed and who benefits before you decide.' },
    { kind:'chat_message', role:'user',      content:'I would weigh the harm to the few against the benefit to the many, and say so openly.' },
    { kind:'chat_message', role:'assistant', content:'Good. What would change your answer?' },
    { kind:'chat_message', role:'user',      content:'If the harm were irreversible, I would not accept it for an uncertain benefit.' },
    { kind:'chat_session_state', role:'system', title:'Lesson 1' },
  ];
  for (const [seq, payload] of turns.entries()) {
    const id = `${sessionId}:r${seq}`;
    await pool.query(
      `INSERT INTO runtime_records (id, session_id, seq, scene_id, created_at, data) VALUES ($1,$2,$3,'sc1',$4,$5)`,
      [id, sessionId, seq, now, { id, seq, sceneId:'sc1', createdAt: now, sessionId, payload }]);
  }
}
const researcher = await signIn('researcher@example.test');
const proj = await api(researcher, `/api/level3/studies/${studyId}/project`, { method:'POST' });
console.log(`events          ${proj.status === 200 ? JSON.parse(proj.body).total.written + ' written' : 'projection failed'}`);

const exp = await api(researcher, `/api/level3/studies/${studyId}/export?format=json`);
const data = exp.status === 200 ? JSON.parse(exp.body) : null;
console.log(`export          ${data ? `${data.rows.length} rows, ${data.quality.participants} participant(s), ${data.quality.excluded.participantsWithoutConsent} excluded for consent` : 'failed'}`);

await pool.end();
console.log('\nSign in as researcher@example.test to see the study, or export it.');
