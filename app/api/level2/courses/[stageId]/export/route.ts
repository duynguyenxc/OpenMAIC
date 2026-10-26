/**
 * Level 2 — course data export, CSV or JSON.
 *
 * The instruction's field list, restricted to what actually exists:
 * *"Include only data actually available. Do not fabricate derived measures."*
 * Quiz scores and PBL events are therefore not separate columns — in this
 * schema they are runtime records distinguished by `sessionKind`, and
 * inventing columns for them would be inventing data.
 *
 * It also forbids exporting passwords, API keys, tokens or credentials. None
 * is reachable from these queries: the export joins only enrolment, profile
 * and runtime tables.
 */
import { requireCourseInstructor } from '@/lib/level2/authorization';
import { courseTrajectory } from '@/lib/level2/course-results';
import { level2Pool } from '@/lib/level2/db';
import { apiError, toCsv, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };

/**
 * The field names the instruction suggests, in its order.
 *
 * Populated from what this deployment's runtime records actually contain:
 * `activity_type` is `payload.kind`, and `learner_input` / `agent_response`
 * are `payload.content` split by `payload.role`.
 *
 * `quiz_item`, `quiz_response`, `quiz_score`, `PBL_event` and
 * `progress_state` are present as columns and left empty. No quiz or PBL
 * record has been produced in this deployment yet — the only payload kinds
 * observed are `chat_message` and `chat_session_state` — so any mapping would
 * be guessed, and the instruction says plainly: "Include only data actually
 * available. Do not fabricate derived measures." The columns stay so the
 * shape does not change when such records appear; `payload` carries the
 * untouched record meanwhile.
 */
const COLUMNS = [
  'course_id',
  'course_title',
  'student_identifier',
  'student_internal_id',
  'student_email',
  'activity_id',
  'activity_type',
  'session_kind',
  'seq',
  'timestamp',
  'learner_input',
  'agent_response',
  'quiz_item',
  'quiz_response',
  'quiz_score',
  'PBL_event',
  'progress_state',
  'payload',
];

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    await requireCourseInstructor(ownerId, stageId);

    const query = new URL(req.url).searchParams;
    const format = (query.get('format') ?? 'json').toLowerCase();
    if (format !== 'json' && format !== 'csv') {
      return apiError(400, 'INVALID_FORMAT', 'format must be csv or json', headers);
    }

    // v3 asks for an export narrowed by activity, student, date range and data
    // type. Every filter is optional and absent means "everything", so the
    // plain link an instructor already had keeps working unchanged.
    const student = query.get('student')?.trim().toLowerCase() || null;
    const activity = query.get('activity')?.trim() || null;
    const from = query.get('from')?.trim() || null;
    const to = query.get('to')?.trim() || null;
    for (const [name, value] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return apiError(400, 'INVALID_DATE', `${name} must be a date like 2026-10-23`, headers);
      }
    }
    // `types` is a comma-separated list of activity types to keep.
    const types = (query.get('types') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const pool = await level2Pool();
    const { rows: courseRows } = await pool.query(
      `SELECT title FROM courses WHERE openmaic_stage_id = $1`,
      [stageId],
    );
    const title = (courseRows[0] as { title?: string } | undefined)?.title ?? '';
    const all = await courseTrajectory(stageId);
    const events = all.filter((e) => {
      if (
        student &&
        (e.email ?? '').toLowerCase() !== student &&
        (e.externalIdentifier ?? '').toLowerCase() !== student
      )
        return false;
      if (activity && e.activityId !== activity) return false;
      if (types.length && !types.includes(e.activityType ?? '')) return false;
      // A date filter on a row with no timestamp would silently drop the
      // opened-but-empty sessions, so those are kept unless a range is asked
      // for — at which point "no timestamp" cannot be inside it.
      const when = e.createdAt ?? e.sessionStartedAt;
      if ((from || to) && !when) return false;
      if (from && when && when.slice(0, 10) < from) return false;
      if (to && when && when.slice(0, 10) > to) return false;
      return true;
    });

    const flat = events.map((event) => ({
      course_id: stageId,
      course_title: title,
      student_identifier: event.externalIdentifier ?? '',
      student_internal_id: event.studentInternalId,
      student_email: event.email,
      activity_id: event.activityId ?? '',
      activity_type: event.activityType ?? '',
      session_kind: event.sessionKind,
      seq: event.seq ?? '',
      timestamp: event.createdAt ?? '',
      learner_input: event.learnerInput ?? '',
      agent_response: event.agentResponse ?? '',
      // Not yet produced by this deployment; see the note on COLUMNS.
      quiz_item: '',
      quiz_response: '',
      quiz_score: '',
      PBL_event: '',
      progress_state: '',
      payload: event.payload === null ? '' : JSON.stringify(event.payload),
    }));

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `course-${stageId}-${stamp}.${format}`;
    const download = new Headers(headers);
    download.set('content-disposition', `attachment; filename="${filename}"`);

    if (format === 'csv') {
      download.set('content-type', 'text/csv; charset=utf-8');
      return new Response(toCsv(flat, COLUMNS), { status: 200, headers: download });
    }
    download.set('content-type', 'application/json');
    return new Response(
      JSON.stringify(
        {
          courseId: stageId,
          courseTitle: title,
          exportedAt: new Date().toISOString(),
          events: flat,
        },
        null,
        2,
      ),
      { status: 200, headers: download },
    );
  });
}
