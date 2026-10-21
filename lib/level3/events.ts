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

  for (const row of rows as Array<Record<string, any>>) {
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
    out.push({ stageId: row.stageId, result: await projectCourseEvents(row.stageId) });
  }
  return out;
}
