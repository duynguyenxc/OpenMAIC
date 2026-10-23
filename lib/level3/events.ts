/**
 * Level 3 — the research event layer.
 *
 * Built as a **projection** of OpenMAIC's own runtime records, not as a second
 * place where the classroom writes. That is what the instruction asks for —
 * "Create a normalized research-event layer referencing OpenMAIC runtime
 * records", "reference existing runtime records rather than duplicating large
 * content" — and it has a property worth more than the tidiness: the classroom
 * cannot be slowed down or broken by research instrumentation that is not in
 * its path. If this layer fails, teaching continues and the events can be
 * rebuilt afterwards, because the originals are untouched.
 *
 * It is also why **no event here can be invented**. "Do not generate fake
 * events. Only record behavior actually occurring in the application." Every
 * row has a `source_runtime_record_id` pointing at the record it was derived
 * from, and the projection is idempotent: a unique index on that column means
 * running it twice cannot double-count, which a research dataset would not
 * survive.
 *
 * What we can actually see today is chat. The instruction lists fifteen event
 * types; this maps the four that exist in this deployment's data and leaves
 * the rest unmapped rather than fabricating them. When a quiz or a PBL record
 * first appears, `classify` gains a branch and the projection is re-run.
 */
import { level2Pool } from '@/lib/level2/db';

/**
 * The row shapes this file reads back. They were `Record<string, any>`, which
 * switches type checking off at exactly the boundary where the database meets
 * the code — and which the repository's own lint gate refuses. CI had never
 * run on this fork, so nobody had seen it.
 */
interface RuntimeRecordRow {
  id: string;
  session_id: string;
  seq: number;
  scene_id: string | null;
  created_at: string;
  data: { payload?: Record<string, unknown> | null } | null;
  learner_id: string;
}

interface ResponseRow {
  id: string;
  learner_id: string;
  activity_id: string;
  attempt_number: number;
  parent_attempt_id: string | null;
  response_type: string;
  submitted_at: string;
  characters: number | string | null;
}

interface FeedbackRow {
  id: string;
  kind: string;
  policy: string;
  model: string | null;
  shown_at: string | null;
  created_at: string;
  learner_id: string;
  activity_id: string;
  attempt_number: number;
}

export interface ProjectionResult {
  examined: number;
  written: number;
  skippedUnmapped: number;
  unmappedKinds: string[];
}

/**
 * One runtime record → one event type, or null when we do not know what it is.
 * Null is the honest answer and it is counted, so an unmapped kind shows up in
 * the projection report instead of disappearing.
 */
function classify(payload: Record<string, unknown> | null): string | null {
  const kind = typeof payload?.kind === 'string' ? payload.kind : null;
  const role = typeof payload?.role === 'string' ? payload.role : null;
  if (!kind) return null;
  if (kind === 'chat_message') {
    if (role === 'user') return 'STUDENT_MESSAGE';
    if (role === 'assistant' || role === 'system') return 'AGENT_RESPONSE';
    return 'CHAT_MESSAGE';
  }
  if (kind === 'chat_session_state') return 'SCENE_OPEN';
  if (kind.startsWith('quiz')) return role === 'user' ? 'QUIZ_RESPONSE' : 'QUIZ_RESULT';
  if (kind.startsWith('pbl')) return 'PBL_ACTION';
  return null;
}

/**
 * Keep the payload small. The original record holds the full content and is
 * one join away; copying it wholesale would double the database for nothing.
 */
function summarize(payload: Record<string, unknown> | null): Record<string, unknown> {
  const content = typeof payload?.content === 'string' ? payload.content : null;
  return {
    kind: payload?.kind ?? null,
    role: payload?.role ?? null,
    characters: content ? content.length : null,
    excerpt: content ? content.slice(0, 280) : null,
  };
}

/**
 * Project every runtime record of one course into research events.
 *
 * Scoped to a course rather than run over everything, so it can be triggered
 * when a course is added to a study and re-run cheaply afterwards.
 */
export async function projectCourseEvents(stageId: string): Promise<ProjectionResult> {
  const pool = await level2Pool();

  const { rows: courseRows } = await pool.query(
    `SELECT c.id,
            (SELECT sc.study_id FROM study_courses sc WHERE sc.course_id = c.id LIMIT 1) AS study_id
       FROM courses c WHERE c.openmaic_stage_id = $1`,
    [stageId],
  );
  const course = courseRows[0] as { id: string; study_id: string | null } | undefined;
  if (!course) return { examined: 0, written: 0, skippedUnmapped: 0, unmappedKinds: [] };

  // learner_key is 'user:' || auth_user_id, which is how a runtime record is
  // tied back to a person at all. Level 2 made that the server's business; we
  // only read it.
  const { rows } = await pool.query(
    `SELECT r.id, r.session_id, r.seq, r.scene_id, r.created_at, r.data,
            up.id AS learner_id
       FROM runtime_records r
       JOIN runtime_sessions s ON s.id = r.session_id
       JOIN user_profiles up
         ON ('user:' || up.auth_user_id::text) = s.learner_key
      WHERE s.stage_id = $1
      ORDER BY r.created_at, r.seq`,
    [stageId],
  );

  let written = 0;
  let skipped = 0;
  const unmapped = new Set<string>();

  for (const row of rows as RuntimeRecordRow[]) {
    const payload = (row.data?.payload ?? null) as Record<string, unknown> | null;
    const eventType = classify(payload);
    if (!eventType) {
      skipped += 1;
      if (typeof payload?.kind === 'string') unmapped.add(payload.kind);
      else unmapped.add('(no kind)');
      continue;
    }

    const result = await pool.query(
      `INSERT INTO research_events
         (study_id, course_id, learner_id, session_id, activity_id, event_type,
          source_runtime_record_id, event_timestamp, sequence_number, structured_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (source_runtime_record_id) DO NOTHING`,
      [
        course.study_id,
        course.id,
        row.learner_id,
        row.session_id,
        row.scene_id,
        eventType,
        row.id,
        row.created_at,
        row.seq,
        summarize(payload),
      ],
    );
    written += result.rowCount ?? 0;
  }

  return {
    examined: rows.length,
    written,
    skippedUnmapped: skipped,
    unmappedKinds: [...unmapped],
  };
}

/**
 * Level 3B's own events.
 *
 * Responses, revisions and feedback are **ours**, not OpenMAIC's, so they are
 * projected from our tables rather than from `runtime_records`. The rule is
 * unchanged: one source row, one event, `source_runtime_record_id` naming it,
 * and the unique index making a second run a no-op. Nothing is invented — if
 * no student has answered anything, this writes nothing.
 */
export async function projectCourseAssessmentEvents(stageId: string): Promise<ProjectionResult> {
  const pool = await level2Pool();
  const { rows: courseRows } = await pool.query(
    `SELECT c.id,
            (SELECT sc.study_id FROM study_courses sc WHERE sc.course_id = c.id LIMIT 1) AS study_id
       FROM courses c WHERE c.openmaic_stage_id = $1`,
    [stageId],
  );
  const course = courseRows[0] as { id: string; study_id: string | null } | undefined;
  if (!course) return { examined: 0, written: 0, skippedUnmapped: 0, unmappedKinds: [] };

  let examined = 0;
  let written = 0;

  // A first answer and a revision are different events, because measuring
  // learning change is the reason revisions are kept at all.
  const { rows: responses } = await pool.query(
    `SELECT id, learner_id, activity_id, attempt_number, parent_attempt_id,
            response_type, submitted_at, length(response_text) AS characters
       FROM learner_responses WHERE course_id = $1 ORDER BY submitted_at`,
    [course.id],
  );
  for (const r of responses as ResponseRow[]) {
    examined += 1;
    const result = await pool.query(
      `INSERT INTO research_events
         (study_id, course_id, learner_id, session_id, activity_id, event_type,
          source_runtime_record_id, event_timestamp, sequence_number, structured_payload)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (source_runtime_record_id) DO NOTHING`,
      [
        course.study_id,
        course.id,
        r.learner_id,
        r.activity_id,
        r.attempt_number > 1 ? 'RESPONSE_REVISION' : 'RESPONSE_SUBMITTED',
        `response:${r.id}`,
        r.submitted_at,
        r.attempt_number,
        {
          responseType: r.response_type,
          attemptNumber: r.attempt_number,
          revisionOf: r.parent_attempt_id,
          characters: Number(r.characters),
        },
      ],
    );
    written += result.rowCount ?? 0;
  }

  const { rows: feedback } = await pool.query(
    `SELECT fe.id, fe.kind, fe.policy, fe.model, fe.shown_at, fe.created_at,
            lr.learner_id, lr.activity_id, lr.attempt_number
       FROM feedback_events fe JOIN learner_responses lr ON lr.id = fe.response_id
      WHERE lr.course_id = $1 ORDER BY fe.created_at`,
    [course.id],
  );
  for (const f of feedback as FeedbackRow[]) {
    examined += 1;
    const result = await pool.query(
      `INSERT INTO research_events
         (study_id, course_id, learner_id, session_id, activity_id, event_type,
          source_runtime_record_id, event_timestamp, sequence_number, structured_payload)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (source_runtime_record_id) DO NOTHING`,
      [
        course.study_id,
        course.id,
        f.learner_id,
        f.activity_id,
        // Generated and shown are different facts, and the instruction asks
        // for both: "Record all generated feedback", and FEEDBACK_SHOWN.
        f.shown_at ? 'FEEDBACK_SHOWN' : 'FEEDBACK_GENERATED',
        `feedback:${f.id}`,
        f.created_at,
        f.attempt_number,
        { kind: f.kind, policy: f.policy, model: f.model, shown: Boolean(f.shown_at) },
      ],
    );
    written += result.rowCount ?? 0;
  }

  return { examined, written, skippedUnmapped: 0, unmappedKinds: [] };
}

/** Project every course in a study. Returns one result per course. */
export async function projectStudyEvents(
  studyId: string,
): Promise<Array<{ stageId: string; result: ProjectionResult }>> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `SELECT c.openmaic_stage_id AS "stageId"
       FROM study_courses sc JOIN courses c ON c.id = sc.course_id
      WHERE sc.study_id = $1`,
    [studyId],
  );
  const out = [];
  for (const row of rows as Array<{ stageId: string }>) {
    const runtime = await projectCourseEvents(row.stageId);
    const assessment = await projectCourseAssessmentEvents(row.stageId);
    out.push({
      stageId: row.stageId,
      result: {
        examined: runtime.examined + assessment.examined,
        written: runtime.written + assessment.written,
        skippedUnmapped: runtime.skippedUnmapped,
        unmappedKinds: runtime.unmappedKinds,
      },
    });
  }
  return out;
}
