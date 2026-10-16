/**
 * Level 2 — enrolment management.
 *
 * Listing is open to any instructor on the course (and ADMIN); changing the
 * roll is restricted to the OWNER, which is what the instruction describes:
 * *"OWNER … can enroll students"*, while an EDITOR *"can edit course; can
 * inspect students"*.
 */
import { requireCourseInstructor, requireCourseOwner } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };

async function courseIdFor(stageId: string): Promise<string | undefined> {
  const pool = await level2Pool();
  const { rows } = await pool.query(`SELECT id FROM courses WHERE openmaic_stage_id = $1`, [stageId]);
  return (rows[0] as { id?: string } | undefined)?.id;
}

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    await requireCourseInstructor(ownerId, stageId);
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT up.id, up.email, up.display_name AS "displayName",
              up.external_identifier AS "externalIdentifier",
              e.status, e.enrolled_at AS "enrolledAt"
         FROM enrollments e
         JOIN courses c       ON c.id = e.course_id
         JOIN user_profiles up ON up.id = e.student_id
        WHERE c.openmaic_stage_id = $1
        ORDER BY up.email`,
      [stageId],
    );
    return json({ students: rows }, 200, headers);
  });
}

/** Enrol by email, so an instructor never needs to know an internal id. */
export function POST(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    const actor = await requireCourseOwner(ownerId, stageId);

    const { email } = (await req.json().catch(() => ({}))) as { email?: unknown };
    if (typeof email !== 'string' || !email.trim()) {
      return apiError(400, 'EMAIL_REQUIRED', 'a student email is required', headers);
    }

    const pool = await level2Pool();
    const { rows: students } = await pool.query(
      `SELECT id, role, status FROM user_profiles WHERE lower(email) = lower($1)`,
      [email.trim()],
    );
    const student = students[0] as { id: string; role: string; status: string } | undefined;
    if (!student) return apiError(404, 'NO_SUCH_USER', 'no account with that email', headers);
    if (student.role !== 'STUDENT') {
      return apiError(400, 'NOT_A_STUDENT', 'only STUDENT accounts can be enrolled', headers);
    }

    const courseId = await courseIdFor(stageId);
    if (!courseId) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);

    await pool.query(
      `INSERT INTO enrollments (course_id, student_id, status, enrolled_by)
       VALUES ($1, $2, 'ACTIVE', $3)
       ON CONFLICT (course_id, student_id)
         DO UPDATE SET status = 'ACTIVE', enrolled_by = EXCLUDED.enrolled_by`,
      [courseId, student.id, actor.profileId],
    );
    return json({ enrolled: email, status: 'ACTIVE' }, 200, headers);
  });
}

/**
 * Removal sets the enrolment INACTIVE rather than deleting it: the learner's
 * interaction records stay attributable, which the research use this platform
 * is heading towards depends on. Access stops on the next request either way.
 */
export function DELETE(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    await requireCourseOwner(ownerId, stageId);
    const email = new URL(req.url).searchParams.get('email');
    if (!email) return apiError(400, 'EMAIL_REQUIRED', 'email query parameter is required', headers);

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `UPDATE enrollments e SET status = 'INACTIVE'
         FROM courses c, user_profiles up
        WHERE c.id = e.course_id AND up.id = e.student_id
          AND c.openmaic_stage_id = $1 AND lower(up.email) = lower($2)
        RETURNING up.email`,
      [stageId, email],
    );
    if (!rows[0]) return apiError(404, 'NOT_ENROLLED', 'that student is not enrolled', headers);
    return json({ removed: email, status: 'INACTIVE' }, 200, headers);
  });
}
