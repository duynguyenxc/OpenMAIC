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
import { contextAsText, gatherContext } from '@/lib/level3/knowledge';
import { recordUsage } from '@/lib/level3/usage';
import { embedText } from '@/lib/level3/embeddings';
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
                lr.attempt_number AS "attemptNumber", lr.learner_id AS "learnerId",
                lr.course_id AS "courseUuid",
                c.openmaic_stage_id AS "stageId", c.title AS "courseTitle",
                ra.rubric_id AS "rubricId",
                ac.permitted_resources AS "permittedResources",
                ac.prohibited_behavior AS "prohibitedBehavior",
                ac.uncertainty_behavior AS "uncertaintyBehavior"
           FROM learner_responses lr
           JOIN courses c ON c.id = lr.course_id
           LEFT JOIN rubric_assignments ra
             ON ra.course_id = lr.course_id AND ra.activity_id = lr.activity_id
           LEFT JOIN agent_configurations ac ON ac.id = c.agent_configuration_id
          WHERE lr.id = $1`,
        [responseId],
      );
      const response = rows[0] as
        | { id: string; responseText: string; activityId: string; attemptNumber: number;
            learnerId: string; courseUuid: string;
            stageId: string; courseTitle: string; rubricId: string | null;
            permittedResources: string[] | null; prohibitedBehavior: string | null;
            uncertaintyBehavior: string | null }
        | undefined;
      if (!response) return apiError(404, 'RESPONSE_NOT_FOUND', 'no such response', headers);

      // Only an instructor of the course the response belongs to.
      const actor = await requireCourseInstructor(principal.ownerId, response.stageId);

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

      // Level 3C: context comes through the KnowledgeProvider interface, and
      // every passage handed to the model is recorded against this response.
      // An agent configuration's permitted_resources is the bound, enforced
      // here rather than asked for in a prompt.
      const context = await gatherContext({
        stageId: response.stageId,
        query: response.responseText.slice(0, 500),
        purpose: 'assessment',
        permittedResources: response.permittedResources,
        courseId: response.courseUuid,
        learnerId: response.learnerId,
        responseId: response.id,
        embed: embedText,
      });

      const outcome = await assessResponse({
        responseText: response.responseText,
        activityPrompt: typeof body.activityPrompt === 'string' ? body.activityPrompt : null,
        courseContext: response.courseTitle,
        referenceAnswer: typeof body.referenceAnswer === 'string' ? body.referenceAnswer : null,
        rubric, model, modelString, serverManaged,
        knowledgeContext: contextAsText(context.passages) || null,
        agentRules: {
          prohibited: response.prohibitedBehavior,
          uncertainty: response.uncertaintyBehavior,
        },
      });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: created } = await client.query(
          `INSERT INTO assessments (response_id, rubric_id, rubric_version, assessor_kind,
                                    model, prompt_version, raw_result)
           VALUES ($1, $2, $3, 'AI', $4, $5, $6) RETURNING id`,
          [responseId, rubric.id, rubric.version, outcome.model, outcome.promptVersion,
           // The retrieval request id goes into the record, so "which
           // resources were provided to the model" is one join away.
           { ...(outcome.raw as Record<string, unknown>), retrievalRequestId: context.requestId }],
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

        // Level 3D: one row per call, so usage by course, instructor, study
        // and institution is a GROUP BY rather than a second ledger.
        await recordUsage({
          stage: 'level3-assessment', model: outcome.model, purpose: 'assessment',
          courseId: response.courseUuid, responseId, actorId: actor.profileId,
          studyId: null, institutionId: null,
        });

        return json(
          {
            assessmentId,
            rubric: { id: rubric.id, title: rubric.title, version: rubric.version },
            model: outcome.model,
            promptVersion: outcome.promptVersion,
            scores: outcome.scores,
            feedbackSuggestions: outcome.feedbackSuggestions,
            parsed: outcome.scores.length > 0,
            knowledge: { requestId: context.requestId, sources: context.sources,
                         passages: context.passages.length },
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
