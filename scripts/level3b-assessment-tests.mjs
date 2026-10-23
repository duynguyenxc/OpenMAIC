// Level 3B — rubrics, AI assessment, human review, adaptive feedback,
// response revisions. Run against a live server; nothing is mocked.
//
// The AI assessment makes a real model call, so this suite costs a little
// money. Set SKIP_LLM=1 to run everything except the two tests that need one.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^"|"$/g, ''),
      ];
    }),
);
const pw = Object.fromEntries(
  readFileSync('.env.level2-test-accounts', 'utf8')
    .split('\n')
    .filter((l) => l.includes('@'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const SUPA = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const REF = new URL(SUPA).hostname.split('.')[0];
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SKIP_LLM = process.env.SKIP_LLM === '1';
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

async function signIn(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw[email] }),
  });
  const s = await r.json();
  if (!r.ok) throw new Error(`sign-in ${email}: ${JSON.stringify(s)}`);
  return {
    email,
    userId: s.user.id,
    cookie: `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s)).toString('base64url')}`,
  };
}
async function api(actor, path, init = {}) {
  const r = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(actor ? { cookie: actor.cookie } : {}),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    redirect: 'manual',
  });
  return { status: r.status, body: await r.text() };
}
const J = JSON.stringify;
let passed = 0,
  failed = 0;
function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}  ${detail}`);
  }
}
const refused = (r) => r.status === 401 || r.status === 403 || r.status === 404;

const A = {
  admin: await signIn('admin@example.test'),
  instructor: await signIn('instructor1@example.test'),
  other: await signIn('instructor2@example.test'),
  student: await signIn('student1@example.test'),
  student2: await signIn('student2@example.test'),
};

const RUN = `test ${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
const here = dirname(fileURLToPath(import.meta.url));
const scene = JSON.parse(readFileSync(join(here, 'fixtures/scene.json'), 'utf8'));
const stage = JSON.parse(readFileSync(join(here, 'fixtures/stage.json'), 'utf8'));

async function makeCourse(actor, title) {
  const id = '3B' + Math.random().toString(36).slice(2, 10);
  const doc = {
    stage: { ...stage, id, name: title, createdAt: Date.now(), updatedAt: Date.now() },
    scenes: [{ ...scene, id: 'sc1', stageId: id, order: 1, title: 'Lesson 1' }],
    outline: { outlines: [] },
  };
  const r = await api(actor, `/api/persistence/documents/${id}`, { method: 'PUT', body: J(doc) });
  if (r.status >= 300) throw new Error(`create ${title}: ${r.status} ${r.body}`);
  await pool.query(`UPDATE courses SET title=$2, status='PUBLISHED' WHERE openmaic_stage_id=$1`, [
    id,
    title,
  ]);
  return id;
}

const COURSE = await makeCourse(A.instructor, `3B course (${RUN})`);
await pool.query(
  `INSERT INTO enrollments (course_id, student_id, status)
   SELECT c.id, up.id, 'ACTIVE' FROM courses c, user_profiles up
    WHERE c.openmaic_stage_id=$1 AND up.email=$2
   ON CONFLICT (course_id, student_id) DO UPDATE SET status='ACTIVE'`,
  [COURSE, 'student1@example.test'],
);

console.log('RUBRICS — versioned, and immutable once published');
let rubricId;
{
  const body = {
    title: `Reasoning rubric (${RUN})`,
    version: '1.0',
    status: 'PUBLISHED',
    description: 'Judges an argument about an ethical trade-off.',
    dimensions: [
      {
        dimensionId: 'claim',
        name: 'Clarity of claim',
        maxScore: 4,
        levels: [
          { score: 0, descriptor: 'no claim' },
          { score: 4, descriptor: 'a clear, specific claim' },
        ],
      },
      {
        dimensionId: 'evidence',
        name: 'Use of evidence',
        maxScore: 4,
        levels: [
          { score: 0, descriptor: 'none' },
          { score: 4, descriptor: 'specific and relevant' },
        ],
      },
      {
        dimensionId: 'counter',
        name: 'Engages a counter-argument',
        maxScore: 4,
        levels: [
          { score: 0, descriptor: 'ignores objections' },
          { score: 4, descriptor: 'answers the strongest objection' },
        ],
      },
    ],
  };
  const r = await api(A.instructor, '/api/level3/rubrics', { method: 'POST', body: J(body) });
  check('an instructor can create a rubric', r.status === 201, r.body.slice(0, 110));
  rubricId = r.status === 201 ? JSON.parse(r.body).id : null;

  const again = await api(A.instructor, '/api/level3/rubrics', { method: 'POST', body: J(body) });
  check(
    'the same title at the same version is refused',
    again.status === 409 && again.body.includes('VERSION_EXISTS'),
    `got ${again.status}`,
  );

  const v2 = await api(A.instructor, '/api/level3/rubrics', {
    method: 'POST',
    body: J({ ...body, version: '1.1' }),
  });
  check('a new version is accepted', v2.status === 201, v2.body.slice(0, 80));

  const byStudent = await api(A.student, '/api/level3/rubrics');
  check('a student cannot see rubrics', refused(byStudent), `got ${byStudent.status}`);

  const { rows } = await pool.query(
    `SELECT count(*)::int n FROM rubric_dimensions WHERE rubric_id = $1`,
    [rubricId],
  );
  check('the rubric stored its three dimensions', rows[0].n === 3, `n=${rows[0].n}`);
}

console.log('\nATTACHING — a rubric and a feedback policy per activity');
{
  const r = await api(A.instructor, `/api/level3/courses/${COURSE}/rubric`, {
    method: 'POST',
    body: J({ activityId: 'sc1', rubricId, feedbackPolicy: 'AFTER_FIRST_RESPONSE' }),
  });
  check('the owner can attach a rubric with a policy', r.status === 200, r.body.slice(0, 100));

  const bad = await api(A.instructor, `/api/level3/courses/${COURSE}/rubric`, {
    method: 'POST',
    body: J({ activityId: 'sc1', rubricId, feedbackPolicy: 'WHENEVER' }),
  });
  check('an unknown feedback policy is refused', bad.status === 400, `got ${bad.status}`);

  const byOther = await api(A.other, `/api/level3/courses/${COURSE}/rubric`, {
    method: 'POST',
    body: J({ activityId: 'sc1', rubricId }),
  });
  check(
    'another instructor cannot attach a rubric to this course',
    refused(byOther),
    `got ${byOther.status}`,
  );
}

console.log('\nRESPONSES — attempts are kept, never overwritten');
let firstResponse, revision;
{
  const r1 = await api(A.student, '/api/level3/responses', {
    method: 'POST',
    body: J({
      stageId: COURSE,
      activityId: 'sc1',
      responseText: 'I think the benefit matters more than the harm.',
    }),
  });
  check('a student can submit a response', r1.status === 201, r1.body.slice(0, 100));
  firstResponse = r1.status === 201 ? JSON.parse(r1.body).id : null;
  check(
    'the first attempt is numbered 1',
    r1.status === 201 && JSON.parse(r1.body).attemptNumber === 1,
    r1.body.slice(0, 60),
  );

  const r2 = await api(A.student, '/api/level3/responses', {
    method: 'POST',
    body: J({
      stageId: COURSE,
      activityId: 'sc1',
      responseText:
        'Revised: the benefit outweighs the harm only if the harm is reversible, and here it is not, so I would refuse.',
    }),
  });
  check(
    'a revision is a new attempt, not an edit',
    r2.status === 201 && JSON.parse(r2.body).attemptNumber === 2,
    r2.body.slice(0, 80),
  );
  revision = r2.status === 201 ? JSON.parse(r2.body).id : null;
  check(
    'the revision points at the attempt it revises',
    r2.status === 201 && JSON.parse(r2.body).parentAttemptId === firstResponse,
    r2.body.slice(0, 90),
  );

  const { rows } = await pool.query(
    `SELECT count(*)::int n FROM learner_responses lr JOIN courses c ON c.id = lr.course_id
      WHERE c.openmaic_stage_id = $1`,
    [COURSE],
  );
  check('both attempts still exist', rows[0].n === 2, `n=${rows[0].n}`);

  const notEnrolled = await api(A.student2, '/api/level3/responses', {
    method: 'POST',
    body: J({ stageId: COURSE, activityId: 'sc1', responseText: 'I am not in this course.' }),
  });
  check('a student not enrolled cannot answer', refused(notEnrolled), `got ${notEnrolled.status}`);

  const mine = await api(A.student, `/api/level3/responses?stageId=${COURSE}`);
  const list = mine.status === 200 ? JSON.parse(mine.body).responses : [];
  check(
    'a student sees their own responses without identities',
    mine.status === 200 && list.length === 2 && list.every((x) => x.email === null),
    mine.body.slice(0, 90),
  );
}

console.log('\nAI ASSESSMENT');
let aiAssessmentId = null;
if (SKIP_LLM) {
  console.log('  SKIP  (SKIP_LLM=1)');
} else {
  const r = await api(A.instructor, `/api/level3/responses/${revision}/assess`, {
    method: 'POST',
    body: J({ activityPrompt: 'Should the benefit to many outweigh harm to a few? Argue.' }),
  });
  check('an instructor can run the AI assessment', r.status === 201, r.body.slice(0, 160));
  if (r.status === 201) {
    const d = JSON.parse(r.body);
    aiAssessmentId = d.assessmentId;
    check(
      'it produced a score for each rubric dimension',
      d.scores.length === 3,
      J(d.scores.map((s) => s.dimensionId)),
    );
    check(
      'it recorded the model and the prompt version',
      Boolean(d.model) && d.promptVersion === 'assess-v1',
      `${d.model} ${d.promptVersion}`,
    );
    check(
      'scores stay inside the rubric maximum',
      d.scores.every((s) => s.score >= 0 && s.score <= 4),
      J(d.scores.map((s) => s.score)),
    );

    const { rows } = await pool.query(
      `SELECT raw_result IS NOT NULL AS raw, rubric_version FROM assessments WHERE id = $1`,
      [aiAssessmentId],
    );
    check('the raw model result was stored', rows[0]?.raw === true);
    check(
      'the rubric version was stored with the assessment',
      rows[0]?.rubric_version === '1.0',
      rows[0]?.rubric_version,
    );
  }

  const byOther = await api(A.other, `/api/level3/responses/${revision}/assess`, {
    method: 'POST',
    body: J({}),
  });
  check(
    'an instructor of another course cannot assess this response',
    refused(byOther),
    `got ${byOther.status}`,
  );
  const byStudent = await api(A.student, `/api/level3/responses/${revision}/assess`, {
    method: 'POST',
    body: J({}),
  });
  check('a student cannot run an assessment', refused(byStudent), `got ${byStudent.status}`);
}

console.log('\nHUMAN REVIEW — the AI score survives the review');
{
  const before = await pool.query(
    `SELECT count(*)::int n FROM assessment_scores s JOIN assessments a ON a.id = s.assessment_id
      WHERE a.response_id = $1 AND a.assessor_kind = 'AI'`,
    [revision],
  );

  const r = await api(A.instructor, `/api/level3/responses/${revision}/review`, {
    method: 'POST',
    body: J({
      decision: 'REVISED',
      feedback: 'The counter-argument is stronger than the model allowed.',
      scores: [
        { dimensionId: 'claim', score: 4 },
        { dimensionId: 'evidence', score: 2 },
        {
          dimensionId: 'counter',
          score: 4,
          evidence: 'They answer the irreversibility objection.',
        },
      ],
    }),
  });
  check('an instructor can revise the assessment', r.status === 201, r.body.slice(0, 120));

  const after = await pool.query(
    `SELECT count(*)::int n FROM assessment_scores s JOIN assessments a ON a.id = s.assessment_id
      WHERE a.response_id = $1 AND a.assessor_kind = 'AI'`,
    [revision],
  );
  check(
    'the AI scores were not overwritten',
    after.rows[0].n === before.rows[0].n,
    `${before.rows[0].n} -> ${after.rows[0].n}`,
  );

  const kinds = await pool.query(
    `SELECT assessor_kind, count(*)::int n FROM assessments WHERE response_id = $1
      GROUP BY assessor_kind ORDER BY assessor_kind`,
    [revision],
  );
  const have = Object.fromEntries(kinds.rows.map((k) => [k.assessor_kind, k.n]));
  check(
    'AI and human assessments exist side by side',
    (have.HUMAN ?? 0) > 0 && (SKIP_LLM || (have.AI ?? 0) > 0),
    J(have),
  );

  const view = await api(A.instructor, `/api/level3/responses/${revision}/review`);
  const scores = view.status === 200 ? JSON.parse(view.body) : {};
  check(
    'the final score comes from the human when one exists',
    scores.final?.source === 'HUMAN',
    J(scores.final?.source),
  );
  check(
    'the review is recorded with its decision',
    scores.review?.decision === 'REVISED',
    J(scores.review),
  );

  const byStudent = await api(A.student, `/api/level3/responses/${revision}/review`, {
    method: 'POST',
    body: J({ decision: 'ACCEPTED' }),
  });
  check('a student cannot review an assessment', refused(byStudent), `got ${byStudent.status}`);
}

console.log('\nADAPTIVE FEEDBACK — the policy decides, not the caller');
{
  // The policy is AFTER_FIRST_RESPONSE, so attempt 1 must be refused.
  const onFirst = await api(A.student, `/api/level3/responses/${firstResponse}/feedback`, {
    method: 'POST',
    body: J({ requested: true }),
  });
  check(
    'feedback is refused on the first attempt under AFTER_FIRST_RESPONSE',
    onFirst.status === 409 && onFirst.body.includes('FEEDBACK_NOT_ALLOWED'),
    `got ${onFirst.status}`,
  );

  await api(A.instructor, `/api/level3/courses/${COURSE}/rubric`, {
    method: 'POST',
    body: J({ activityId: 'sc1', rubricId, feedbackPolicy: 'OFF' }),
  });
  const whenOff = await api(A.student, `/api/level3/responses/${revision}/feedback`, {
    method: 'POST',
    body: J({ requested: true }),
  });
  check(
    'feedback is refused when the policy is OFF',
    whenOff.status === 409 && whenOff.body.includes('switched off'),
    whenOff.body.slice(0, 90),
  );

  await api(A.instructor, `/api/level3/courses/${COURSE}/rubric`, {
    method: 'POST',
    body: J({ activityId: 'sc1', rubricId, feedbackPolicy: 'ON_REQUEST' }),
  });

  if (SKIP_LLM) {
    console.log('  SKIP  generation (SKIP_LLM=1)');
  } else {
    const r = await api(A.student, `/api/level3/responses/${revision}/feedback`, {
      method: 'POST',
      body: J({
        requested: true,
        activityPrompt: 'Should the benefit to many outweigh harm to a few? Argue.',
      }),
    });
    check(
      'a student can request feedback when the policy allows it',
      r.status === 201,
      r.body.slice(0, 140),
    );
    if (r.status === 201) {
      const d = JSON.parse(r.body);
      check(
        'the feedback has a kind and content',
        Boolean(d.kind && d.content),
        J({ kind: d.kind }),
      );
      check(
        'the feedback records its model and prompt version',
        Boolean(d.model) && d.promptVersion === 'feedback-v1',
        `${d.model} ${d.promptVersion}`,
      );
    }
    const { rows } = await pool.query(
      `SELECT count(*)::int n, count(shown_at)::int shown FROM feedback_events WHERE response_id = $1`,
      [revision],
    );
    check('every generated piece of feedback was recorded', rows[0].n > 0, `n=${rows[0].n}`);
    check(
      'feedback shown to a student is marked as shown',
      rows[0].shown > 0,
      `shown=${rows[0].shown}`,
    );
  }

  const someoneElse = await api(A.student2, `/api/level3/responses/${revision}/feedback`, {
    method: 'POST',
    body: J({ requested: true }),
  });
  check(
    "a student cannot ask for feedback on somebody else's answer",
    refused(someoneElse),
    `got ${someoneElse.status}`,
  );
}

console.log('\nRESEARCH EVENTS — 3B activity reaches the dataset');
{
  const { rows: study } = await pool.query(
    `SELECT id FROM studies WHERE protocol_identifier = 'PROTO-2026-001' LIMIT 1`,
  );
  const studyId = study[0].id;
  await pool.query(
    `INSERT INTO study_courses (study_id, course_id, experimental_condition)
     SELECT $1, c.id, 'CONDITION-3B' FROM courses c WHERE c.openmaic_stage_id = $2
     ON CONFLICT DO NOTHING`,
    [studyId, COURSE],
  );

  const researcher = await signIn('researcher@example.test');
  const r = await api(researcher, `/api/level3/studies/${studyId}/project`, { method: 'POST' });
  check('projection includes the new course', r.status === 200, r.body.slice(0, 90));

  const { rows: ev } = await pool.query(
    `SELECT event_type, count(*)::int n FROM research_events e
       JOIN courses c ON c.id = e.course_id
      WHERE c.openmaic_stage_id = $1 GROUP BY event_type ORDER BY event_type`,
    [COURSE],
  );
  const have = Object.fromEntries(ev.map((x) => [x.event_type, x.n]));
  check(
    'a first answer is recorded as RESPONSE_SUBMITTED',
    (have.RESPONSE_SUBMITTED ?? 0) > 0,
    J(have),
  );
  check('a revision is recorded as RESPONSE_REVISION', (have.RESPONSE_REVISION ?? 0) > 0, J(have));
  if (!SKIP_LLM) {
    check(
      'feedback reaches the dataset',
      (have.FEEDBACK_SHOWN ?? 0) + (have.FEEDBACK_GENERATED ?? 0) > 0,
      J(have),
    );
  }

  const again = await api(researcher, `/api/level3/studies/${studyId}/project`, { method: 'POST' });
  check(
    'projecting twice still writes nothing the second time',
    again.status === 200 && JSON.parse(again.body).total.written === 0,
    again.status === 200
      ? `wrote ${JSON.parse(again.body).total.written}`
      : again.body.slice(0, 60),
  );

  await pool.query(
    `DELETE FROM study_courses WHERE study_id = $1 AND course_id =
    (SELECT id FROM courses WHERE openmaic_stage_id = $2)`,
    [studyId, COURSE],
  );
}

// ── Clean up ────────────────────────────────────────────────────────────────
{
  const { rows } = await pool.query(
    `DELETE FROM courses WHERE title LIKE $1 RETURNING openmaic_stage_id`,
    [`%(${RUN})%`],
  );
  const { rowCount: rubrics } = await pool.query(`DELETE FROM rubrics WHERE title LIKE $1`, [
    `%(${RUN})%`,
  ]);
  console.log(`\n(removed ${rows.length} course(s) and ${rubrics} rubric(s) from this run)`);
}

await pool.end();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
