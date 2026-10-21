/**
 * Level 3B — adaptive feedback for one response.
 *
 * The policy decides, not the caller. `OFF` refuses; `ON_REQUEST` refuses
 * unless the student asked; `AFTER_FIRST_RESPONSE` refuses on the first
 * attempt, because the first answer is the measurement and feeding back into
 * it contaminates what a study is trying to observe.
 *
 * A refusal is a `409` with the reason in words, not a silent empty response.
 * Every piece generated is recorded whether or not it was shown.
 */
import { requireAuthenticatedUser, requireCourseEnrollment, requireCourseInstructor }
  from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { loadRubric } from '@/lib/level3/assessment';
import { generateFeedback, policyAllows, recordFeedback, type FeedbackPolicy }
  from '@/lib/level3/feedback';
import { apiError, json } from '@/lib/level2/route-helpers';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ responseId: string }> };

export function POST(req: Request, { params }: Params): Promise<Response> {
  return withRequestOwner(req, async (principal, headers) => {
    const { responseId } = await params;
    try {
      const actor = await requireAuthenticatedUser(principal.ownerId);
      const pool = await level2Pool();

      const { rows } = await pool.query(
        `SELECT lr.id, lr.learner_id AS "learnerId", lr.response_text AS "responseText",
                lr.activity_id AS "activityId", lr.attempt_number AS "attemptNumber",
                lr.course_id AS "courseId", c.openmaic_stage_id AS "stageId",
                ra.rubric_id AS "rubricId", ra.feedback_policy AS "feedbackPolicy"
           FROM learner_responses lr
           JOIN courses c ON c.id = lr.course_id
           LEFT JOIN rubric_assignments ra
             ON ra.course_id = lr.course_id AND ra.activity_id = lr.activity_id
          WHERE lr.id = $1`,
        [responseId],
      );
      const response = rows[0] as
        | { id: string; learnerId: string; responseText: string; activityId: string;
            attemptNumber: number; courseId: string; stageId: string;
            rubricId: string | null; feedbackPolicy: string | null }
        | undefined;
      if (!response) return apiError(404, 'RESPONSE_NOT_FOUND', 'no such response', headers);

      // A student may ask for feedback on their own answer and nobody else's.
      if (actor.role === 'STUDENT') {
        await requireCourseEnrollment(principal.ownerId, response.stageId);
        if (response.learnerId !== actor.profileId) {
          return apiError(403, 'FORBIDDEN', 'that is not your response', headers);
        }
      } else {
        await requireCourseInstructor(principal.ownerId, response.stageId);
      }

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const policy = (response.feedbackPolicy ?? 'OFF') as FeedbackPolicy;
      const verdict = policyAllows(policy, {
        attemptNumber: response.attemptNumber,
        requested: body.requested === true || actor.role === 'STUDENT',
        submitted: body.submitted !== false,
      });
      if (!verdict.allowed) {
        return apiError(409, 'FEEDBACK_NOT_ALLOWED', verdict.reason ?? 'feedback is not available here', headers);
      }
      if (!response.rubricId) {
        return apiError(409, 'NO_RUBRIC', 'no rubric is attached to this activity', headers);
      }
      const rubric = await loadRubric(response.rubricId);
      if (!rubric) return apiError(404, 'RUBRIC_NOT_FOUND', 'no such rubric', headers);

      // Steer on the latest AI scores if there are any; without them the
      // service still works, it just has less to aim at.
      const { rows: scoreRows } = await pool.query(
        `SELECT s.dimension_id AS "dimensionId", s.score::float AS score, s.evidence,
                s.confidence::float AS confidence
           FROM assessment_scores s
           JOIN assessments a ON a.id = s.assessment_id
          WHERE a.response_id = $1 AND a.assessor_kind = 'AI'
          ORDER BY a.created_at DESC`,
        [responseId],
      );

      const { rows: priorAttempts } = await pool.query(
        `SELECT attempt_number AS "attemptNumber", response_text AS "responseText"
           FROM learner_responses
          WHERE course_id = $1 AND learner_id = $2 AND activity_id = $3
            AND attempt_number < $4
          ORDER BY attempt_number`,
        [response.courseId, response.learnerId, response.activityId, response.attemptNumber],
      );
      const { rows: priorFeedback } = await pool.query(
        `SELECT fe.content FROM feedback_events fe
           JOIN learner_responses lr ON lr.id = fe.response_id
          WHERE lr.course_id = $1 AND lr.learner_id = $2 AND lr.activity_id = $3
          ORDER BY fe.created_at DESC LIMIT 3`,
        [response.courseId, response.learnerId, response.activityId],
      );

      const { model, modelString, serverManaged } =
        await resolveModelFromRequest(req as never, body, 'level3-feedback');

      const feedback = await generateFeedback({
        responseText: response.responseText,
        activityPrompt: typeof body.activityPrompt === 'string' ? body.activityPrompt : null,
        rubric,
        scores: scoreRows as never,
        priorAttempts: priorAttempts as Array<{ attemptNumber: number; responseText: string }>,
        priorFeedback: (priorFeedback as Array<{ content: string }>).map((f) => f.content),
        model, modelString, serverManaged,
      });

      const id = await recordFeedback(responseId, feedback, policy, actor.role === 'STUDENT');
      return json({ id, ...feedback, policy }, 201, headers);
    } catch (error) {
      const { AuthorizationError } = await import('@/lib/level2/authorization');
      if (error instanceof AuthorizationError) {
        return apiError(error.status, error.code, error.message, headers);
      }
      throw error;
    }
  });
}
