/**
 * Level 3B — run the AI assessment for one response.
 *
 * Instructor-driven rather than automatic, for now: assessment costs money and
 * a study's design decides when it happens. It writes a new `assessments` row
 * with `assessor_kind = 'AI'` and never touches a human one.
 *
 * The raw model result is stored whatever it was, including an answer that did
 * not parse, because *"Store: ... raw model result"* is how anyone later tells
 * a bad score from a bad reply.
 */
import { requireCourseInstructor } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { assessResponse, loadRubric, scoresFor } from '@/lib/level3/assessment';
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
      const pool = await level2Pool();
      const { rows } = await pool.query(
        `SELECT lr.id, lr.response_text AS "responseText", lr.activity_id AS "activityId",
                lr.attempt_number AS "attemptNumber",
                c.openmaic_stage_id AS "stageId", c.title AS "courseTitle",
                ra.rubric_id AS "rubricId"
           FROM learner_responses lr
           JOIN courses c ON c.id = lr.course_id
           LEFT JOIN rubric_assignments ra
             ON ra.course_id = lr.course_id AND ra.activity_id = lr.activity_id
          WHERE lr.id = $1`,
        [responseId],
      );
      const response = rows[0] as
        | { id: string; responseText: string; activityId: string; attemptNumber: number;
            stageId: string; courseTitle: string; rubricId: string | null }
        | undefined;
      if (!response) return apiError(404, 'RESPONSE_NOT_FOUND', 'no such response', headers);

      // Only an instructor of the course the response belongs to.
      await requireCourseInstructor(principal.ownerId, response.stageId);

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const rubricId = typeof body.rubricId === 'string' ? body.rubricId : response.rubricId;
      if (!rubricId) {
        return apiError(409, 'NO_RUBRIC',
          'no rubric is attached to this activity; attach one first', headers);
      }
      const rubric = await loadRubric(rubricId);
      if (!rubric) return apiError(404, 'RUBRIC_NOT_FOUND', 'no such rubric', headers);

      const { model, modelString, serverManaged } =
        await resolveModelFromRequest(req as never, body, 'level3-assessment');

      const outcome = await assessResponse({
        responseText: response.responseText,
        activityPrompt: typeof body.activityPrompt === 'string' ? body.activityPrompt : null,
        courseContext: response.courseTitle,
        referenceAnswer: typeof body.referenceAnswer === 'string' ? body.referenceAnswer : null,
        rubric, model, modelString, serverManaged,
      });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: created } = await client.query(
          `INSERT INTO assessments (response_id, rubric_id, rubric_version, assessor_kind,
                                    model, prompt_version, raw_result)
           VALUES ($1, $2, $3, 'AI', $4, $5, $6) RETURNING id`,
          [responseId, rubric.id, rubric.version, outcome.model, outcome.promptVersion, outcome.raw],
        );
        const assessmentId = (created[0] as { id: string }).id;
        for (const s of outcome.scores) {
          await client.query(
            `INSERT INTO assessment_scores (assessment_id, dimension_id, score, evidence, confidence)
             VALUES ($1, $2, $3, $4, $5)`,
            [assessmentId, s.dimensionId, s.score, s.evidence, s.confidence],
          );
        }
        await client.query('COMMIT');

        return json(
          {
            assessmentId,
            rubric: { id: rubric.id, title: rubric.title, version: rubric.version },
            model: outcome.model,
            promptVersion: outcome.promptVersion,
            scores: outcome.scores,
            feedbackSuggestions: outcome.feedbackSuggestions,
            parsed: outcome.scores.length > 0,
            scoresNow: await scoresFor(responseId),
          },
          201,
          headers,
        );
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      const { AuthorizationError } = await import('@/lib/level2/authorization');
      if (error instanceof AuthorizationError) {
        return apiError(error.status, error.code, error.message, headers);
      }
      throw error;
    }
  });
}
