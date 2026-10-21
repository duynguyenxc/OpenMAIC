/**
 * Level 2 — transfer course ownership.
 *
 * Adding a colleague and handing the course over are different acts, and
 * conflating them is what caused S1-1: an owner who passed their own address
 * to the co-instructor endpoint had their OWNER row overwritten with EDITOR
 * and lost their own course. Ownership moves only through here, where it is
 * explicit, atomic, and leaves the previous owner as an EDITOR rather than
 * with nothing.
 */
import { requireCourseOwner } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { looksLikeEmail } from '@/lib/level2/validation';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };

export function POST(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    await requireCourseOwner(ownerId, stageId);

    const { email } = (await req.json().catch(() => ({}))) as { email?: unknown };
    if (typeof email !== 'string' || !email.trim()) {
      return apiError(400, 'EMAIL_REQUIRED', 'an instructor email is required', headers);
    }
    if (!looksLikeEmail(email)) {
      return apiError(400, 'MALFORMED_EMAIL', 'that is not an email address', headers);
    }

    const pool = await level2Pool();
    const { rows: found } = await pool.query(
      `SELECT id, role FROM user_profiles WHERE lower(email) = lower($1)`,
      [email.trim()],
    );
    const next = found[0] as { id: string; role: string } | undefined;
    if (!next) return apiError(404, 'NO_SUCH_USER', 'no account with that email', headers);
    if (next.role === 'STUDENT') {
      return apiError(400, 'NOT_AN_INSTRUCTOR', 'a student cannot own a course', headers);
    }

    const { rows: courses } = await pool.query(
      `SELECT id, owner_instructor_id AS "ownerId" FROM courses WHERE openmaic_stage_id = $1`,
      [stageId],
    );
    const course = courses[0] as { id: string; ownerId: string } | undefined;
    if (!course) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);
    if (course.ownerId === next.id) {
      return apiError(409, 'ALREADY_OWNER', 'that account already owns this course', headers);
    }

    // One transaction: the course is never left with two owners or none. The
    // partial unique index on (course_id) WHERE permission = 'OWNER' would
    // refuse the second state anyway; this makes the first impossible too.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE course_instructors SET permission = 'EDITOR'
          WHERE course_id = $1 AND permission = 'OWNER'`,
        [course.id],
      );
      await client.query(
        `INSERT INTO course_instructors (course_id, instructor_id, permission, added_by)
         VALUES ($1, $2, 'OWNER', $2)
         ON CONFLICT (course_id, instructor_id) DO UPDATE SET permission = 'OWNER'`,
        [course.id, next.id],
      );
      await client.query(`UPDATE courses SET owner_instructor_id = $2 WHERE id = $1`, [
        course.id,
        next.id,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return json({ owner: email.trim(), previousOwnerBecame: 'EDITOR' }, 200, headers);
  });
}
