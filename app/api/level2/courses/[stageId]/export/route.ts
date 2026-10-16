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

const COLUMNS = [
  'course_id',
  'course_title',
  'student_identifier',
  'student_email',
  'session_kind',
  'scene_id',
  'seq',
  'timestamp',
  'payload',
];

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    await requireCourseInstructor(ownerId, stageId);

    const format = (new URL(req.url).searchParams.get('format') ?? 'json').toLowerCase();
    if (format !== 'json' && format !== 'csv') {
      return apiError(400, 'INVALID_FORMAT', 'format must be csv or json', headers);
    }

    const pool = await level2Pool();
    const { rows: courseRows } = await pool.query(
      `SELECT title FROM courses WHERE openmaic_stage_id = $1`,
      [stageId],
    );
    const title = (courseRows[0] as { title?: string } | undefined)?.title ?? '';
    const events = await courseTrajectory(stageId);

    const flat = events.map((event) => ({
      course_id: stageId,
      course_title: title,
      student_identifier: event.externalIdentifier ?? '',
      student_email: event.email,
      session_kind: event.sessionKind,
      scene_id: event.sceneId ?? '',
      seq: event.seq ?? '',
      timestamp: event.createdAt ?? '',
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
      JSON.stringify({ courseId: stageId, courseTitle: title, exportedAt: new Date().toISOString(), events: flat }, null, 2),
      { status: 200, headers: download },
    );
  });
}
