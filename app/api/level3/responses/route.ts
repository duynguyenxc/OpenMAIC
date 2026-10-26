/**
 * Level 3B — learner responses, and their revisions.
 *
 * *"Support multiple attempts. Store each version independently. Do not
 * overwrite previous attempts."* A revision is therefore a new row pointing at
 * the attempt it revises, never an update, so the chain
 * Initial → Feedback → Revision 1 → Feedback → Revision 2 stays readable and
 * a study can measure learning change rather than only the final answer.
 *
 * A student may write only their own response, and the server derives whose it
 * is from the session — the browser cannot name a learner, exactly as in the
 * runtime path Level 2 hardened.
 */
import {
  requireAuthenticatedUser,
  requireCourseEnrollment,
  requireCourseInstructor,
} from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** An instructor reads a course's responses; a student reads their own. */
export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);
    const url = new URL(req.url);
    const stageId = url.searchParams.get('stageId');
    if (!stageId) return apiError(400, 'COURSE_REQUIRED', 'stageId is required', headers);

    const mine = actor.role === 'STUDENT';
    if (mine) await requireCourseEnrollment(ownerId, stageId);
    else await requireCourseInstructor(ownerId, stageId);

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT lr.id, lr.activity_id AS "activityId", lr.attempt_number AS "attemptNumber",
              lr.parent_attempt_id AS "parentAttemptId", lr.response_type AS "responseType",
              lr.response_text AS "responseText", lr.submitted_at AS "submittedAt",
              up.external_identifier AS "studentId",
              CASE WHEN $3 THEN NULL ELSE up.email END AS email,
              (SELECT count(*) FROM assessments a WHERE a.response_id = lr.id AND a.assessor_kind = 'AI') AS "aiAssessments",
              (SELECT count(*) FROM assessments a WHERE a.response_id = lr.id AND a.assessor_kind = 'HUMAN') AS "humanAssessments",
              -- Totals for each assessor, so a caller can see where the two
              -- disagree without fetching every dimension of every response.
              (SELECT sum(s.score)::float FROM assessment_scores s
                 JOIN assessments a ON a.id = s.assessment_id
                WHERE a.response_id = lr.id AND a.assessor_kind = 'AI')    AS "aiTotal",
              (SELECT sum(s.score)::float FROM assessment_scores s
                 JOIN assessments a ON a.id = s.assessment_id
                WHERE a.response_id = lr.id AND a.assessor_kind = 'HUMAN') AS "humanTotal",
              (SELECT decision FROM assessment_reviews ar WHERE ar.response_id = lr.id
                ORDER BY ar.created_at DESC LIMIT 1) AS "reviewDecision",
              (SELECT count(*) FROM feedback_events fe WHERE fe.response_id = lr.id) AS "feedbackCount"
         FROM learner_responses lr
         JOIN courses c ON c.id = lr.course_id
         JOIN user_profiles up ON up.id = lr.learner_id
        WHERE c.openmaic_stage_id = $1
          AND ($2::uuid IS NULL OR lr.learner_id = $2)
        ORDER BY lr.activity_id, up.email, lr.attempt_number`,
      [stageId, mine ? actor.profileId : null, mine],
    );
    return json({ responses: rows }, 200, headers);
  });
}

/** Submit an answer, or a revision of one. */
export function POST(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const stageId = typeof body.stageId === 'string' ? body.stageId : '';
    const activityId = typeof body.activityId === 'string' ? body.activityId.trim() : '';
    const text = typeof body.responseText === 'string' ? body.responseText.trim() : '';
    if (!stageId || !activityId || !text) {
      return apiError(
        400,
        'RESPONSE_REQUIRED',
        'a course, an activity and a response are required',
        headers,
      );
    }

    // A student must be enrolled; an instructor may answer their own course
    // when trying an activity out, and an administrator may do either.
    if (actor.role === 'STUDENT') await requireCourseEnrollment(ownerId, stageId);
    else await requireCourseInstructor(ownerId, stageId);

    const pool = await level2Pool();
    const { rows: courseRows } = await pool.query(
      `SELECT id FROM courses WHERE openmaic_stage_id = $1`,
      [stageId],
    );
    const course = courseRows[0] as { id: string } | undefined;
    if (!course) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialised per learner and activity: two submissions at once must not
      // take the same attempt number, which the unique index would refuse.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `response:${course.id}:${actor.profileId}:${activityId}`,
      ]);

      const { rows: last } = await client.query(
        `SELECT id, attempt_number AS "attemptNumber" FROM learner_responses
          WHERE course_id = $1 AND learner_id = $2 AND activity_id = $3
          ORDER BY attempt_number DESC LIMIT 1`,
        [course.id, actor.profileId, activityId],
      );
      const previous = last[0] as { id: string; attemptNumber: number } | undefined;

      const { rows } = await client.query(
        `INSERT INTO learner_responses
           (course_id, learner_id, activity_id, attempt_number, parent_attempt_id,
            response_type, original_input, response_text, processing_metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, attempt_number AS "attemptNumber", parent_attempt_id AS "parentAttemptId"`,
        [
          course.id,
          actor.profileId,
          activityId,
          (previous?.attemptNumber ?? 0) + 1,
          previous?.id ?? null,
          'TYPED_TEXT',
          // Typed text is its own original. Handwriting and audio (3D) will
          // put the raw upload here and the transcription in response_text.
          text,
          text,
          { source: 'typed', receivedAt: new Date().toISOString() },
        ],
      );
      await client.query('COMMIT');
      return json(rows[0], 201, headers);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
