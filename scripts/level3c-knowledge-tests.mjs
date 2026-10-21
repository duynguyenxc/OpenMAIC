// Level 3C — knowledge resources, the three retrievers, bounded agents,
// multiple simultaneous sources, and provenance.
//
// Real retrieval against a real database, and real embeddings when a key is
// configured. SKIP_LLM=1 skips the two tests that need a model or an
// embedding provider; everything else still runs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const SKIP_LLM = process.env.SKIP_LLM === '1';
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
let passed = 0, failed = 0;
function check(label, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`); }
  else    { failed += 1; console.log(`  FAIL  ${label}  ${detail}`); }
}
const refused = (r) => r.status === 401 || r.status === 403 || r.status === 404;

const A = {
  instructor: await signIn('instructor1@example.test'),
  other: await signIn('instructor2@example.test'),
  student: await signIn('student1@example.test'),
};

const RUN = `test ${new Date().toISOString().slice(11,19).replace(/:/g,'')}`;
const here = dirname(fileURLToPath(import.meta.url));
const scene = JSON.parse(readFileSync(join(here, 'fixtures/scene.json'), 'utf8'));
const stage = JSON.parse(readFileSync(join(here, 'fixtures/stage.json'), 'utf8'));

async function makeCourse(actor, title) {
  const id = '3C' + Math.random().toString(36).slice(2, 10);
  const doc = { stage: { ...stage, id, name: title, createdAt: Date.now(), updatedAt: Date.now() },
                scenes: [{ ...scene, id: 'sc1', stageId: id, order: 1, title: 'Lesson 1' }],
                outline: { outlines: [] } };
  const r = await api(actor, `/api/persistence/documents/${id}`, { method:'PUT', body: J(doc) });
  if (r.status >= 300) throw new Error(`create ${title}: ${r.status} ${r.body}`);
  await pool.query(`UPDATE courses SET title=$2, status='PUBLISHED' WHERE openmaic_stage_id=$1`, [id, title]);
  return id;
}

const COURSE = await makeCourse(A.instructor, `3C course (${RUN})`);
await pool.query(
  `INSERT INTO enrollments (course_id, student_id, status)
   SELECT c.id, up.id, 'ACTIVE' FROM courses c, user_profiles up
    WHERE c.openmaic_stage_id=$1 AND up.email=$2
   ON CONFLICT (course_id, student_id) DO UPDATE SET status='ACTIVE'`, [COURSE, 'student1@example.test']);

console.log('RESOURCES — four types, one interface');
const resources = {};
{
  for (const [key, type, title] of [
    ['docs',   'DOCUMENT_COLLECTION', `Policy corpus (${RUN})`],
    ['vector', 'VECTOR_INDEX',        `Evidence index (${RUN})`],
    ['graph',  'KNOWLEDGE_GRAPH',     `Concept graph (${RUN})`],
  ]) {
    const r = await api(A.instructor, '/api/level3/knowledge', { method:'POST',
      body: J({ title, type, visibility: 'PRIVATE', description: 'test fixture' }) });
    check(`an instructor can create a ${type}`, r.status === 201, r.body.slice(0,110));
    if (r.status === 201) resources[key] = JSON.parse(r.body).id;
  }

  const bad = await api(A.instructor, '/api/level3/knowledge', { method:'POST',
    body: J({ title: `Nonsense (${RUN})`, type: 'TAROT_DECK' }) });
  check('an unknown resource type is refused', bad.status === 400, `got ${bad.status}`);

  const byStudent = await api(A.student, '/api/level3/knowledge');
  check('a student cannot see knowledge resources', refused(byStudent), `got ${byStudent.status}`);
}

console.log('\nINGEST');
{
  const d1 = await api(A.instructor, `/api/level3/knowledge/${resources.docs}/documents`, {
    method:'POST', body: J({ title: 'Irreversibility rule',
      content: 'An irreversible harm may not be traded for an uncertain benefit.\n\nWhere a harm can be undone, the calculation differs and proportionality applies.' }) });
  check('a document can be added and chunked', d1.status === 201 && JSON.parse(d1.body).chunks >= 1, d1.body.slice(0,120));

  const d2 = await api(A.instructor, `/api/level3/knowledge/${resources.vector}/documents`, {
    method:'POST', body: J({ title: 'Empirical note',
      content: 'Studies of disaster response find that reversible interventions are adopted faster because the cost of being wrong is bounded.' }) });
  check('a vector resource accepts a document', d2.status === 201, d2.body.slice(0,120));
  if (d2.status === 201) {
    const d = JSON.parse(d2.body);
    if (SKIP_LLM) console.log(`  SKIP  embedding (SKIP_LLM=1; searchable: ${d.searchable})`);
    else check('its chunks were embedded', d.embedded > 0, `embedded=${d.embedded} (${d.searchable})`);
  }

  const g = await api(A.instructor, `/api/level3/knowledge/${resources.graph}/documents`, {
    method:'POST', body: J({ edges: [
      { subject: 'irreversible harm', predicate: 'blocks', object: 'proportionality defence',
        evidence: 'from the policy corpus' },
      { subject: 'reversible harm', predicate: 'permits', object: 'proportionality defence' },
    ] }) });
  check('a knowledge graph accepts triples', g.status === 201 && JSON.parse(g.body).edgesWritten === 2, g.body.slice(0,110));

  const byOther = await api(A.other, `/api/level3/knowledge/${resources.docs}/documents`, {
    method:'POST', body: J({ title: 'Intrusion', content: 'not mine' }) });
  check('only the owner may add to a resource', refused(byOther), `got ${byOther.status}`);
}

console.log('\nATTACHING — several sources at once, named by the researcher');
{
  for (const [key, name, role, priority] of [
    ['docs',   'authoritative', 'policy and evidence', 10],
    ['graph',  'concepts',      'structured relations', 20],
    ['vector', 'counterpoint',  'empirical perspectives', 30],
  ]) {
    const r = await api(A.instructor, `/api/level3/courses/${COURSE}/knowledge`, {
      method:'POST', body: J({ resourceId: resources[key], sourceName: name, sourceRole: role, priority }) });
    check(`"${name}" can be attached to the course`, r.status === 200, r.body.slice(0,100));
  }

  const list = await api(A.instructor, `/api/level3/courses/${COURSE}/knowledge`);
  const sources = list.status === 200 ? JSON.parse(list.body).sources : [];
  check('all three sources are attached at once', sources.length === 3, J(sources.map((s) => s.sourceName)));
  check('they come back in priority order',
    sources.map((s) => s.sourceName).join(',') === 'authoritative,concepts,counterpoint',
    J(sources.map((s) => s.sourceName)));
  check('the researcher\'s own labels are preserved, not normalised',
    sources.some((s) => s.sourceName === 'counterpoint' && s.sourceRole === 'empirical perspectives'),
    J(sources.map((s) => `${s.sourceName}/${s.sourceRole}`)));

  const byOther = await api(A.other, `/api/level3/courses/${COURSE}/knowledge`, {
    method:'POST', body: J({ resourceId: resources.docs, sourceName: 'intrusion' }) });
  check('another instructor cannot attach a source here', refused(byOther), `got ${byOther.status}`);
}

console.log('\nAGENT CONFIGURATIONS — versioned, and bounded');
let boundedAgent;
{
  const r = await api(A.instructor, '/api/level3/agents', { method:'POST',
    body: J({ name: `Bounded tutor (${RUN})`, version: '1.0',
      agentRole: 'Socratic tutor', pedagogicalFunction: 'elicit reasoning',
      responseStyle: 'short, plain, no lists',
      prohibitedBehavior: 'give the answer, or cite material you were not given',
      uncertaintyBehavior: 'say you are unsure rather than guess',
      permittedResources: [resources.docs] }) });
  check('an agent configuration can be created', r.status === 201, r.body.slice(0,120));
  boundedAgent = r.status === 201 ? JSON.parse(r.body).id : null;

  const again = await api(A.instructor, '/api/level3/agents', { method:'POST',
    body: J({ name: `Bounded tutor (${RUN})`, version: '1.0' }) });
  check('the same name at the same version is refused', again.status === 409, `got ${again.status}`);

  const v2 = await api(A.instructor, '/api/level3/agents', { method:'POST',
    body: J({ name: `Bounded tutor (${RUN})`, version: '1.1' }) });
  check('a new version is accepted', v2.status === 201, v2.body.slice(0,80));

  const byStudent = await api(A.student, '/api/level3/agents');
  check('a student cannot see agent configurations', refused(byStudent), `got ${byStudent.status}`);
}

console.log('\nRETRIEVAL — through the interface, with provenance');
let responseId;
{
  const sub = await api(A.student, '/api/level3/responses', { method:'POST',
    body: J({ stageId: COURSE, activityId: 'sc1',
      responseText: 'An irreversible harm cannot be justified by a proportionality defence, so I would refuse.' }) });
  responseId = sub.status === 201 ? JSON.parse(sub.body).id : null;
  check('a response exists to assess', Boolean(responseId), sub.body.slice(0,90));

  // A rubric is needed before assessment will run.
  const rub = await api(A.instructor, '/api/level3/rubrics', { method:'POST',
    body: J({ title: `3C rubric (${RUN})`, version: '1.0', status: 'PUBLISHED',
      dimensions: [{ dimensionId: 'reasoning', name: 'Quality of reasoning', maxScore: 4 }] }) });
  const rubricId = rub.status === 201 ? JSON.parse(rub.body).id : null;
  await api(A.instructor, `/api/level3/courses/${COURSE}/rubric`, { method:'POST',
    body: J({ activityId: 'sc1', rubricId, feedbackPolicy: 'ON_REQUEST' }) });

  if (SKIP_LLM) {
    console.log('  SKIP  assessment with retrieval (SKIP_LLM=1)');
  } else {
    const r = await api(A.instructor, `/api/level3/responses/${responseId}/assess`, {
      method:'POST', body: J({}) });
    check('assessment runs with retrieved context', r.status === 201, r.body.slice(0,160));
    if (r.status === 201) {
      const d = JSON.parse(r.body);
      check('context came from more than one source',
        d.knowledge.sources.length >= 2, J(d.knowledge.sources.map((s) => s.sourceName)));
      check('at least one passage was retrieved', d.knowledge.passages > 0, J(d.knowledge));
      check('more than one provider was used',
        new Set(d.knowledge.sources.map((s) => s.provider)).size >= 2,
        J(d.knowledge.sources.map((s) => s.provider)));
    }

    const { rows: prov } = await pool.query(
      `SELECT provider, count(*)::int n, count(chunk_id)::int chunks, count(edge_id)::int edges
         FROM retrieval_events WHERE response_id = $1 GROUP BY provider ORDER BY provider`, [responseId]);
    check('every retrieved passage was recorded as provenance', prov.length > 0, J(prov));
    check('provenance names which chunk or which edge',
      prov.every((p) => p.chunks + p.edges === p.n), J(prov));

    const { rows: link } = await pool.query(
      `SELECT raw_result->>'retrievalRequestId' AS rid FROM assessments
        WHERE response_id = $1 AND assessor_kind = 'AI' ORDER BY created_at DESC LIMIT 1`, [responseId]);
    check('the assessment names the retrieval request that fed it',
      Boolean(link[0]?.rid), J(link[0]));
    if (link[0]?.rid) {
      const { rows: same } = await pool.query(
        `SELECT count(*)::int n FROM retrieval_events WHERE request_id = $1`, [link[0].rid]);
      check('that request id resolves to the passages the model was given', same[0].n > 0, `n=${same[0].n}`);
    }
  }
}

console.log('\nBOUNDED AGENT — a restriction enforced, not requested');
if (SKIP_LLM) {
  console.log('  SKIP  (SKIP_LLM=1)');
} else {
  await api(A.instructor, '/api/level3/agents', { method:'PATCH',
    body: J({ stageId: COURSE, agentConfigurationId: boundedAgent }) });

  const sub = await api(A.student, '/api/level3/responses', { method:'POST',
    body: J({ stageId: COURSE, activityId: 'sc1',
      responseText: 'Revised: irreversibility is what blocks the proportionality defence here.' }) });
  const bounded = sub.status === 201 ? JSON.parse(sub.body).id : null;

  const r = await api(A.instructor, `/api/level3/responses/${bounded}/assess`, { method:'POST', body: J({}) });
  check('assessment still runs under a bounded agent', r.status === 201, r.body.slice(0,120));
  if (r.status === 201) {
    const d = JSON.parse(r.body);
    check('only the permitted resource was consulted',
      d.knowledge.sources.length === 1 && d.knowledge.sources[0].sourceName === 'authoritative',
      J(d.knowledge.sources.map((s) => s.sourceName)));
  }

  const { rows } = await pool.query(
    `SELECT DISTINCT source_name FROM retrieval_events WHERE response_id = $1`, [bounded]);
  check('provenance shows the bound was real, not advisory',
    rows.length === 1 && rows[0].source_name === 'authoritative', J(rows.map((x) => x.source_name)));
}

console.log('\nDEGRADING GRACEFULLY');
{
  // Point a source at a resource with nothing in it. Retrieval must return
  // less, not fail: "the classroom must continue functioning even if the KG
  // service is unavailable".
  const empty = await api(A.instructor, '/api/level3/knowledge', { method:'POST',
    body: J({ title: `Empty corpus (${RUN})`, type: 'DOCUMENT_COLLECTION' }) });
  const emptyId = empty.status === 201 ? JSON.parse(empty.body).id : null;
  await api(A.instructor, `/api/level3/courses/${COURSE}/knowledge`, { method:'POST',
    body: J({ resourceId: emptyId, sourceName: 'empty', priority: 5 }) });

  const list = await api(A.instructor, `/api/level3/courses/${COURSE}/knowledge`);
  check('an empty source can be attached without breaking anything',
    list.status === 200 && JSON.parse(list.body).sources.length >= 2, list.body.slice(0,80));

  const removed = await api(A.instructor,
    `/api/level3/courses/${COURSE}/knowledge?sourceName=empty`, { method:'DELETE' });
  check('a source can be detached again', removed.status === 200, removed.body.slice(0,80));
}

// ── Clean up ────────────────────────────────────────────────────────────────
{
  const { rows } = await pool.query(
    `DELETE FROM courses WHERE title LIKE $1 RETURNING openmaic_stage_id`, [`%(${RUN})%`]);
  const { rowCount: res } = await pool.query(
    `DELETE FROM knowledge_resources WHERE title LIKE $1`, [`%(${RUN})%`]);
  const { rowCount: agents } = await pool.query(
    `DELETE FROM agent_configurations WHERE name LIKE $1`, [`%(${RUN})%`]);
  const { rowCount: rubrics } = await pool.query(
    `DELETE FROM rubrics WHERE title LIKE $1`, [`%(${RUN})%`]);
  console.log(`\n(removed ${rows.length} course(s), ${res} resource(s), ${agents} agent(s), ${rubrics} rubric(s))`);
}

await pool.end();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
