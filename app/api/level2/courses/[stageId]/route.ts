/** Level 2 — course title, publication state, and removal. OWNER (or ADMIN) only. */
import { requireCourseOwner } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { titleProblem } from '@/lib/level2/validation';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };

const STATUSES = new Set(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export function PATCH(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    await requireCourseOwner(ownerId, stageId);

    const body = (await req.json().catch(() => ({}))) as { title?: unknown; status?: unknown };
    const updates: string[] = [];
    const values: unknown[] = [stageId];

    if (typeof body.title === 'string') {
      // A 5,000-character title used to be accepted and stored, which wrecks
      // every row of the dashboard and every line of the export.
      const problem = titleProblem(body.title);
      if (problem) return apiError(400, 'INVALID_TITLE', problem, headers);
      values.push(body.title.trim());
      updates.push(`title = $${values.length}`);
    }
    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !STATUSES.has(body.status)) {
        return apiError(400, 'INVALID_STATUS', 'status must be DRAFT, PUBLISHED or ARCHIVED', headers);
      }
      values.push(body.status);
      updates.push(`status = $${values.length}`);
    }
    if (!updates.length) return apiError(400, 'NOTHING_TO_UPDATE', 'no title or status given', headers);

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `UPDATE courses SET ${updates.join(', ')}
        WHERE openmaic_stage_id = $1
        RETURNING openmaic_stage_id AS "stageId", title, status`,
      values,
    );
    if (!rows[0]) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);
    return json(rows[0], 200, headers);
  });
}

/**
 * Removal.
 *
 * Learner interaction records are research data, and `instruction v3` is about
 * a research community platform, so one misplaced click must not be able to
 * destroy them. Hence two outcomes rather than one:
 *
 * - a course **nobody has worked in** is deleted outright, with its grants and
 *   enrolments;
 * - a course that **holds learner sessions** is ARCHIVED instead. It leaves
 *   every list, students lose access on their next request, and not a row of
 *   their work is touched. `PATCH { status: 'DRAFT' }` brings it back.
 *
 * An administrator may still destroy a course that holds data, by sending the
 * exact title back in `confirmTitle` — deliberate enough that it cannot happen
 * by reflex.
 *
 * What this does **not** do is reach into OpenMAIC's own document store. The
 * lesson document stays in the instructor's workspace, where OpenMAIC's own
 * delete removes it. Keeping our hands off that store is the rule the whole
 * level is built on, and a two-store delete would be the one place a partial
 * failure could leave a course half-gone.
 */
export function DELETE(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    const actor = await requireCourseOwner(ownerId, stageId);
    const body = (await req.json().catch(() => ({}))) as { confirmTitle?: unknown };

    const pool = await level2Pool();
    const { rows: courses } = await pool.query(
      `SELECT id, title, status FROM courses WHERE openmaic_stage_id = $1`,
      [stageId],
    );
    const course = courses[0] as { id: string; title: string; status: string } | undefined;
    if (!course) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);

    const { rows: counted } = await pool.query(
      `SELECT count(*)::int AS sessions FROM runtime_sessions WHERE stage_id = $1`,
      [stageId],
    );
    const sessions = (counted[0] as { sessions: number }).sessions;

    if (sessions === 0) {
      await pool.query(`DELETE FROM courses WHERE id = $1`, [course.id]);
      return json(
        { deleted: true, title: course.title, learnerSessions: 0, documentKept: true },
        200,
        headers,
      );
    }

    const forced =
      actor.role === 'ADMIN' &&
      typeof body.confirmTitle === 'string' &&
      body.confirmTitle.trim() === course.title.trim();

    if (forced) {
      await pool.query(`DELETE FROM courses WHERE id = $1`, [course.id]);
      return json(
        { deleted: true, title: course.title, learnerSessions: sessions, documentKept: true },
        200,
        headers,
      );
    }

    await pool.query(`UPDATE courses SET status = 'ARCHIVED' WHERE id = $1`, [course.id]);
    return json(
      {
        archived: true,
        title: course.title,
        learnerSessions: sessions,
        message:
          `This course holds ${sessions} learner session${sessions === 1 ? '' : 's'}, so it was ` +
          'archived rather than deleted. Students can no longer open it and their work is kept.',
      },
      200,
      headers,
    );
  });
}
