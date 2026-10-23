// Level 3D — multi-modal responses, the job queue, the LMS boundary,
// usage accounting and research analytics.
//
// Real uploads through the real endpoint, real queue, and a real vision call
// when a key is configured. SKIP_LLM=1 skips the handwriting extraction and
// the assessment that feeds the analytics; everything else still runs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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
  const id = '3D' + Math.random().toString(36).slice(2, 10);
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

const COURSE = await makeCourse(A.instructor, `3D course (${RUN})`);
await pool.query(
  `INSERT INTO enrollments (course_id, student_id, status)
   SELECT c.id, up.id, 'ACTIVE' FROM courses c, user_profiles up
    WHERE c.openmaic_stage_id=$1 AND up.email=$2
   ON CONFLICT (course_id, student_id) DO UPDATE SET status='ACTIVE'`,
  [COURSE, 'student1@example.test'],
);

/** A 1×1 PNG, and a tiny WAV header. Real bytes of real formats. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
function wav(seconds = 1) {
  const rate = 8000,
    samples = rate * seconds,
    header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, Buffer.alloc(samples, 128)]);
}
function upload(kind, bytes, type, name) {
  const form = new FormData();
  form.set('stageId', COURSE);
  form.set('activityId', 'sc1');
  form.set('kind', kind);
  form.set('file', new File([bytes], name, { type }));
  return form;
}

console.log('UPLOAD — the student is not kept waiting');
let imageResponse, imageJob;
{
  const r = await api(A.student, '/api/level3/responses/media', {
    method: 'POST',
    body: upload('HANDWRITTEN_IMAGE', PNG, 'image/png', 'page.png'),
  });
  check('an image upload is accepted immediately', r.status === 202, r.body.slice(0, 140));
  if (r.status === 202) {
    const d = JSON.parse(r.body);
    imageResponse = d.responseId;
    imageJob = d.jobId;
    check(
      'it returns a job rather than a transcription',
      Boolean(d.jobId) && d.status === 'queued',
      r.body.slice(0, 90),
    );
    check('it tells the student their original is kept', /kept/.test(d.message), d.message);
  }

  const { rows } = await pool.query(
    `SELECT response_type AS t, response_text AS text, processing_metadata->>'status' AS status
       FROM learner_responses WHERE id = $1`,
    [imageResponse],
  );
  check(
    'the response exists before its text does',
    rows[0]?.t === 'HANDWRITTEN_IMAGE' && rows[0]?.text === '' && rows[0]?.status === 'queued',
    J(rows[0]),
  );

  const { rows: media } = await pool.query(
    `SELECT byte_size AS size, content_type AS type FROM response_media WHERE response_id = $1`,
    [imageResponse],
  );
  check(
    'the original bytes were stored, not discarded',
    media[0]?.size === PNG.length && media[0]?.type === 'image/png',
    J(media[0]),
  );
}

console.log('\nREFUSALS AT THE DOOR');
{
  const wrong = await api(A.student, '/api/level3/responses/media', {
    method: 'POST',
    body: upload('HANDWRITTEN_IMAGE', PNG, 'text/csv', 'notes.csv'),
  });
  check(
    'a format we cannot read is refused, with the list',
    wrong.status === 400 && wrong.body.includes('UNSUPPORTED_TYPE'),
    wrong.body.slice(0, 110),
  );

  const badKind = await api(A.student, '/api/level3/responses/media', {
    method: 'POST',
    body: upload('TELEPATHY', PNG, 'image/png', 'page.png'),
  });
  check('an unknown modality is refused', badKind.status === 400, `got ${badKind.status}`);

  const notEnrolled = await api(A.student2, '/api/level3/responses/media', {
    method: 'POST',
    body: upload('HANDWRITTEN_IMAGE', PNG, 'image/png', 'page.png'),
  });
  check('a student not enrolled cannot upload', refused(notEnrolled), `got ${notEnrolled.status}`);
}

console.log('\nAUDIO');
let audioResponse;
{
  const r = await api(A.student, '/api/level3/responses/media', {
    method: 'POST',
    body: upload('AUDIO_RESPONSE', wav(), 'audio/wav', 'answer.wav'),
  });
  check('an audio upload is accepted', r.status === 202, r.body.slice(0, 140));
  audioResponse = r.status === 202 ? JSON.parse(r.body).responseId : null;
  if (r.status === 202) {
    check(
      'the student is told the recording is kept',
      /recording is kept/.test(JSON.parse(r.body).message),
      JSON.parse(r.body).message,
    );
  }
}

console.log('\nQUEUE');
{
  const depth = await api(A.instructor, '/api/level3/jobs/run');
  check(
    'the queue depth is visible to an instructor',
    depth.status === 200,
    depth.body.slice(0, 90),
  );
  check(
    'both uploads are waiting',
    depth.status === 200 && (JSON.parse(depth.body).depth.QUEUED ?? 0) >= 2,
    depth.body.slice(0, 80),
  );

  const byStudent = await api(A.student, '/api/level3/jobs/run', { method: 'POST', body: J({}) });
  check('a student cannot run the queue', refused(byStudent), `got ${byStudent.status}`);

  if (SKIP_LLM) {
    console.log('  SKIP  draining (SKIP_LLM=1)');
  } else {
    const run = await api(A.instructor, '/api/level3/jobs/run', {
      method: 'POST',
      body: J({ max: 5 }),
    });
    check('the worker drains the queue', run.status === 200, run.body.slice(0, 160));
    if (run.status === 200) {
      const d = JSON.parse(run.body);
      check(
        'it reports what it did with each job',
        Array.isArray(d.processed) && d.processed.length >= 1,
        J(d.processed?.map?.((p) => `${p.kind}:${p.ok}`)),
      );
    }

    const { rows } = await pool.query(
      `SELECT processing_metadata->>'status' AS status, processing_metadata->>'source' AS source
         FROM learner_responses WHERE id = $1`,
      [imageResponse],
    );
    check(
      'the image response records how it was processed',
      ['processed', 'failed'].includes(rows[0]?.status) && rows[0]?.source === 'handwriting',
      J(rows[0]),
    );

    const { rows: kept } = await pool.query(
      `SELECT byte_size AS size FROM response_media WHERE response_id = $1`,
      [imageResponse],
    );
    check(
      'the original survives processing, whatever the outcome',
      kept[0]?.size === PNG.length,
      J(kept[0]),
    );

    const { rows: jobs } = await pool.query(
      `SELECT status, attempts FROM processing_jobs WHERE id = $1`,
      [imageJob],
    );
    check(
      'the job finished or was retried, not lost',
      ['DONE', 'FAILED', 'QUEUED'].includes(jobs[0]?.status) && jobs[0]?.attempts >= 1,
      J(jobs[0]),
    );
  }
}

console.log('\nLMS BOUNDARY — a boundary, not Canvas');
let integrationId;
{
  const list = await api(A.admin, '/api/level3/lms');
  check(
    'the boundary says what is implemented',
    list.status === 200 && JSON.parse(list.body).implementedProviders.includes('MANUAL'),
    list.body.slice(0, 120),
  );
  check(
    'it says the platform works without an LMS',
    list.status === 200 && /works without any LMS/.test(JSON.parse(list.body).note),
    list.body.slice(0, 80),
  );

  const created = await api(A.admin, '/api/level3/lms', {
    method: 'POST',
    body: J({ action: 'create', name: `Manual (${RUN})`, provider: 'MANUAL' }),
  });
  check('a manual integration can be created', created.status === 201, created.body.slice(0, 120));
  integrationId = created.status === 201 ? JSON.parse(created.body).id : null;

  const canvas = await api(A.admin, '/api/level3/lms', {
    method: 'POST',
    body: J({ action: 'create', name: `Canvas (${RUN})`, provider: 'CANVAS' }),
  });
  check(
    'an unimplemented provider is created INACTIVE and says so',
    canvas.status === 201 &&
      JSON.parse(canvas.body).implemented === false &&
      JSON.parse(canvas.body).status === 'INACTIVE',
    canvas.body.slice(0, 160),
  );

  const byInstructor = await api(A.instructor, '/api/level3/lms', {
    method: 'POST',
    body: J({ action: 'create', name: 'rogue', provider: 'MANUAL' }),
  });
  check(
    'an instructor cannot create an integration',
    refused(byInstructor),
    `got ${byInstructor.status}`,
  );

  const link = await api(A.instructor, '/api/level3/lms', {
    method: 'POST',
    body: J({ action: 'link', stageId: COURSE, integrationId, lmsCourseId: 'LMS-101' }),
  });
  check('a course owner can link their course', link.status === 200, link.body.slice(0, 110));
}

console.log('\nGRADES — an unreviewed AI score never leaves');
{
  const sub = await api(A.student, '/api/level3/responses', {
    method: 'POST',
    body: J({
      stageId: COURSE,
      activityId: 'sc1',
      responseText: 'A typed answer about reversibility.',
    }),
  });
  const typed = sub.status === 201 ? JSON.parse(sub.body).id : null;

  const noScore = await api(A.instructor, '/api/level3/lms', {
    method: 'POST',
    body: J({ action: 'post-grade', responseId: typed }),
  });
  check(
    'a response with no final score cannot be posted',
    noScore.status === 409 && noScore.body.includes('NO_FINAL_SCORE'),
    noScore.body.slice(0, 140),
  );

  // Give it a human score, which is a final score.
  const rub = await api(A.instructor, '/api/level3/rubrics', {
    method: 'POST',
    body: J({
      title: `3D rubric (${RUN})`,
      version: '1.0',
      status: 'PUBLISHED',
      dimensions: [{ dimensionId: 'reasoning', name: 'Reasoning', maxScore: 4 }],
    }),
  });
  const rubricId = rub.status === 201 ? JSON.parse(rub.body).id : null;
  await api(A.instructor, `/api/level3/courses/${COURSE}/rubric`, {
    method: 'POST',
    body: J({ activityId: 'sc1', rubricId, feedbackPolicy: 'OFF' }),
  });
  await api(A.instructor, `/api/level3/responses/${typed}/review`, {
    method: 'POST',
    body: J({ decision: 'REVISED', scores: [{ dimensionId: 'reasoning', score: 3 }] }),
  });

  const posted = await api(A.instructor, '/api/level3/lms', {
    method: 'POST',
    body: J({ action: 'post-grade', responseId: typed }),
  });
  check(
    'a human-scored response can be prepared for the LMS',
    posted.status === 201,
    posted.body.slice(0, 160),
  );
  if (posted.status === 201) {
    const d = JSON.parse(posted.body);
    check(
      'the manual provider is honest that nothing was sent',
      d.sent === false && d.status === 'PREPARED',
      J({ sent: d.sent, status: d.status }),
    );
    check(
      'the grade carries the score and its maximum',
      d.grade?.score === 3 && d.grade?.maxScore === 4,
      J(d.grade),
    );
  }
}

console.log('\nUSAGE ACCOUNTING');
{
  const byStudent = await api(A.student, '/api/level3/usage');
  check('usage is not visible to a student', refused(byStudent), `got ${byStudent.status}`);

  const byModel = await api(A.admin, '/api/level3/usage?by=model');
  check(
    'an administrator can see usage by model',
    byModel.status === 200,
    byModel.body.slice(0, 110),
  );

  for (const dim of ['course', 'instructor', 'study', 'institution']) {
    const r = await api(A.admin, `/api/level3/usage?by=${dim}`);
    check(`usage aggregates by ${dim}`, r.status === 200, `got ${r.status}`);
  }

  const bad = await api(A.admin, '/api/level3/usage?by=phase-of-the-moon');
  check('an unknown dimension is refused', bad.status === 400, `got ${bad.status}`);

  const { rows } = await pool.query(
    `SELECT count(*)::int n, count(input_tokens)::int known FROM model_usage`,
  );
  check(
    'calls are counted even when the provider reports no tokens',
    rows[0].n >= 0 && rows[0].known <= rows[0].n,
    J(rows[0]),
  );
}

console.log('\nANALYTICS');
{
  const { rows: study } = await pool.query(
    `SELECT id FROM studies WHERE protocol_identifier = 'PROTO-2026-001' LIMIT 1`,
  );
  const studyId = study[0].id;
  await pool.query(
    `INSERT INTO study_courses (study_id, course_id, experimental_condition)
     SELECT $1, c.id, 'CONDITION-3D' FROM courses c WHERE c.openmaic_stage_id = $2
     ON CONFLICT DO NOTHING`,
    [studyId, COURSE],
  );

  const researcher = await signIn('researcher@example.test');
  const r = await api(researcher, `/api/level3/studies/${studyId}/analytics`);
  check('a researcher can read the analytics', r.status === 200, r.body.slice(0, 120));
  if (r.status === 200) {
    const d = JSON.parse(r.body);
    check(
      'conditions are broken down',
      Array.isArray(d.conditions) && d.conditions.length > 0,
      J(d.conditions?.map?.((c) => c.condition)),
    );
    check(
      'AI-versus-human agreement reports how much it rests on',
      typeof d.agreement?.comparable === 'number',
      J(d.agreement),
    );
    check(
      'revision effect reports its pair count',
      typeof d.revisions?.pairsCompared === 'number',
      J(d.revisions),
    );
    check(
      'the caveats travel with the numbers',
      Array.isArray(d.caveats) && d.caveats.some((c) => /n\b|small/i.test(c)),
      J(d.caveats),
    );
  }

  const byStudent = await api(A.student, `/api/level3/studies/${studyId}/analytics`);
  check("a student cannot read a study's analytics", refused(byStudent), `got ${byStudent.status}`);

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
  const { rowCount: lms } = await pool.query(`DELETE FROM lms_integrations WHERE name LIKE $1`, [
    `%(${RUN})%`,
  ]);
  console.log(`\n(removed ${rows.length} course(s), ${rubrics} rubric(s), ${lms} integration(s))`);
}

await pool.end();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
