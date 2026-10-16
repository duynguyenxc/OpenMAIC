/**
 * Level 2 — the course list each role is entitled to see.
 *
 * One query per role rather than one query filtered afterwards, so that what a
 * role may see is visible in the SQL and cannot be widened by a forgotten
 * condition downstream:
 *
 * - ADMIN       every course
 * - INSTRUCTOR  courses they are listed on, with their permission
 * - STUDENT     courses they have an ACTIVE enrolment in, and only PUBLISHED
 */
import { actorForOwner } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = `
  SELECT c.id,
         c.openmaic_stage_id      AS "stageId",
         c.title,
         c.status,
         c.created_at             AS "createdAt",
         owner.email              AS "ownerEmail",
         owner.display_name       AS "ownerName",
         (SELECT count(*) FROM enrollments e
           WHERE e.course_id = c.id AND e.status = 'ACTIVE')      AS "studentCount",
         (SELECT count(*) FROM course_instructors ci2
           WHERE ci2.course_id = c.id AND ci2.permission <> 'OWNER') AS "coInstructorCount"
    FROM courses c
    JOIN user_profiles owner ON owner.id = c.owner_instructor_id`;

export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await actorForOwner(ownerId);
    if (!actor) return apiError(401, 'UNAUTHENTICATED', 'no active account', headers);
    const pool = await level2Pool();

    if (actor.role === 'ADMIN') {
      const { rows } = await pool.query(`${BASE} ORDER BY c.created_at DESC`);
      return json({ role: actor.role, courses: rows }, 200, headers);
    }

    if (actor.role === 'INSTRUCTOR') {
      const { rows } = await pool.query(
        `${BASE}
         JOIN course_instructors ci ON ci.course_id = c.id AND ci.instructor_id = $1
         ORDER BY c.created_at DESC`,
        [actor.profileId],
      );
      return json({ role: actor.role, courses: rows }, 200, headers);
    }

    const { rows } = await pool.query(
      `${BASE}
       JOIN enrollments e ON e.course_id = c.id
                         AND e.student_id = $1
                         AND e.status = 'ACTIVE'
       WHERE c.status = 'PUBLISHED'
       ORDER BY c.created_at DESC`,
      [actor.profileId],
    );
    return json({ role: actor.role, courses: rows }, 200, headers);
  });
}
