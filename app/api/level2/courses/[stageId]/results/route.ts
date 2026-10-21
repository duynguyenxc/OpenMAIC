/** Level 2 — course results, and one student's trajectory with ?email=. */
import { requireCourseInstructor } from '@/lib/level2/authorization';
import { courseResults, courseTrajectory } from '@/lib/level2/course-results';
import { level2Pool } from '@/lib/level2/db';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    // Any instructor on the course may inspect its students; an instructor of
    // another course gets 403 from here, never a filtered empty list.
    await requireCourseInstructor(ownerId, stageId);
    const email = new URL(req.url).searchParams.get('email');
    if (email) {
      // An address that is not on this roster used to come back 200 with an
      // empty list — the same answer as a student who is enrolled and has done
      // nothing, and the same answer as a typo. No data leaked either way, but
      // the instructor could not tell the three apart.
      const pool = await level2Pool();
      const { rows } = await pool.query(
        `SELECT 1
           FROM enrollments e
           JOIN courses c        ON c.id = e.course_id
           JOIN user_profiles up ON up.id = e.student_id
          WHERE c.openmaic_stage_id = $1 AND lower(up.email) = lower($2)`,
        [stageId, email],
      );
      if (!rows[0]) {
        return apiError(404, 'NOT_ENROLLED', 'that account is not on this course', headers);
      }
      return json({ email, events: await courseTrajectory(stageId, email) }, 200, headers);
    }
    return json({ students: await courseResults(stageId) }, 200, headers);
  });
}
