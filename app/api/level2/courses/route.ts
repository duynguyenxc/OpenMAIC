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
           WHERE ci2.course_id = c.id AND ci2.permission <> 'OWNER') AS "coInstructorCount",
         (SELECT array_agg(up2.email ORDER BY up2.email)
            FROM course_instructors ci3
            JOIN user_profiles up2 ON up2.id = ci3.instructor_id
           WHERE ci3.course_id = c.id AND ci3.permission <> 'OWNER')  AS "coInstructors",
         -- "last activity" in the instruction's course list: the most recent
         -- moment any enrolled learner touched this course's runtime.
         (SELECT max(GREATEST(s.updated_at, s.created_at))
            FROM runtime_sessions s
           WHERE s.stage_id = c.openmaic_stage_id)                    AS "lastActivityAt"
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

    // A student's own standing in each course. The instructor's Results tab
    // has always reported their sessions and records; the student's own
    // dashboard reported neither, so somebody who had spent an hour in a class
    // was told they had done nothing (O23). Scoped to this learner by
    // `learner_key`, which the server derives — never sent by the browser.
    const { rows } = await pool.query(
      `${BASE.replace(
        'FROM courses c',
        `, (SELECT count(DISTINCT s.id) FROM runtime_sessions s
              WHERE s.stage_id = c.openmaic_stage_id
                AND s.learner_key = 'user:' || $2)                     AS "mySessions",
           (SELECT count(rec.id) FROM runtime_sessions s
              LEFT JOIN runtime_records rec ON rec.session_id = s.id
             WHERE s.stage_id = c.openmaic_stage_id
               AND s.learner_key = 'user:' || $2)                      AS "myRecords",
           (SELECT max(GREATEST(s.updated_at, s.created_at))
              FROM runtime_sessions s
             WHERE s.stage_id = c.openmaic_stage_id
               AND s.learner_key = 'user:' || $2)                      AS "myLastActivityAt"
      FROM courses c`,
      )}
       JOIN enrollments e ON e.course_id = c.id
                         AND e.student_id = $1
                         AND e.status = 'ACTIVE'
       WHERE c.status = 'PUBLISHED'
       ORDER BY c.created_at DESC`,
      [actor.profileId, actor.authUserId],
    );
    return json({ role: actor.role, courses: rows }, 200, headers);
  });
}
