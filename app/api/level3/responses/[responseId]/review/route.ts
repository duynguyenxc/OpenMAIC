/**
 * Level 3B — a human reviews the AI's assessment.
 *
 * *"Instructor must be able to: inspect AI assessment; accept it; revise it;
 * reject it; provide human score; provide feedback."* and *"Do NOT overwrite
 * instructor/human ratings."*
 *
 * So a review is a **record of a decision**, not an edit. Accepting leaves the
 * AI row as the final word; revising writes a separate HUMAN assessment beside
 * it; rejecting records that the AI's answer was discarded. All three keep the
 * AI's original scores intact, which is the entire point — a dataset where the
 * second opinion overwrote the first cannot answer how often they agreed.
 */
import { requireCourseInstructor } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { scoresFor } from '@/lib/level3/assessment';
import { audit } from '@/lib/level3/audit';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ responseId: string }> };
const DECISIONS = new Set(['ACCEPTED', 'REVISED', 'REJECTED']);

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { responseId } = await params;
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT c.openmaic_stage_id AS "stageId" FROM learner_responses lr
         JOIN courses c ON c.id = lr.course_id WHERE lr.id = $1`, [responseId]);
    const found = rows[0] as { stageId: string } | undefined;
    if (!found) return apiError(404, 'RESPONSE_NOT_FOUND', 'no such response', headers);
    await requireCourseInstructor(ownerId, found.stageId);
    return json(await scoresFor(responseId), 200, headers);
  });
}

export function POST(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { responseId } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (!DECISIONS.has(decision)) {
      return apiError(400, 'INVALID_DECISION', 'decision must be ACCEPTED, REVISED or REJECTED', headers);
    }

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT c.openmaic_stage_id AS "stageId", ra.rubric_id AS "rubricId",
              ra.rubric_version AS "rubricVersion"
         FROM learner_responses lr
         JOIN courses c ON c.id = lr.course_id
         LEFT JOIN rubric_assignments ra
           ON ra.course_id = lr.course_id AND ra.activity_id = lr.activity_id
        WHERE lr.id = $1`,
      [responseId],
    );
    const found = rows[0] as
      | { stageId: string; rubricId: string | null; rubricVersion: string | null }
      | undefined;
    if (!found) return apiError(404, 'RESPONSE_NOT_FOUND', 'no such response', headers);
    const actor = await requireCourseInstructor(ownerId, found.stageId);

    const { rows: aiRows } = await pool.query(
      `SELECT id, rubric_id AS "rubricId", rubric_version AS "rubricVersion"
         FROM assessments WHERE response_id = $1 AND assessor_kind = 'AI'
        ORDER BY created_at DESC LIMIT 1`,
      [responseId],
    );
    const ai = aiRows[0] as { id: string; rubricId: string; rubricVersion: string } | undefined;

    const rubricId = ai?.rubricId ?? found.rubricId;
    const rubricVersion = ai?.rubricVersion ?? found.rubricVersion;
    const scores = Array.isArray(body.scores) ? (body.scores as Array<Record<string, unknown>>) : [];

    if (decision === 'REVISED' && scores.length === 0) {
      return apiError(400, 'SCORES_REQUIRED', 'revising means giving your own scores', headers);
    }
    if (decision !== 'ACCEPTED' && !rubricId) {
      return apiError(409, 'NO_RUBRIC', 'no rubric is attached to this activity', headers);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let humanAssessmentId: string | null = null;

      if (scores.length > 0) {
        const { rows: created } = await client.query(
          `INSERT INTO assessments (response_id, rubric_id, rubric_version, assessor_kind, assessor_id)
           VALUES ($1, $2, $3, 'HUMAN', $4) RETURNING id`,
          [responseId, rubricId, rubricVersion, actor.profileId],
        );
        humanAssessmentId = (created[0] as { id: string }).id;
        for (const s of scores) {
          if (typeof s.dimensionId !== 'string') continue;
          await client.query(
            `INSERT INTO assessment_scores (assessment_id, dimension_id, score, evidence)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (assessment_id, dimension_id) DO UPDATE SET score = EXCLUDED.score`,
            [humanAssessmentId, s.dimensionId, Number(s.score) || 0,
             typeof s.evidence === 'string' ? s.evidence : null],
          );
        }
      }

      await client.query(
        `INSERT INTO assessment_reviews
           (response_id, ai_assessment_id, human_assessment_id, decision, reviewer_id, feedback)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [responseId, ai?.id ?? null, humanAssessmentId, decision, actor.profileId,
         typeof body.feedback === 'string' ? body.feedback : null],
      );
      await client.query('COMMIT');

      await audit({ profileId: actor.profileId }, 'ASSESSMENT_REVIEWED',
        { type: 'response', id: responseId },
        { decision, hadAiAssessment: Boolean(ai), wroteHumanAssessment: Boolean(humanAssessmentId) });

      return json({ decision, humanAssessmentId, scores: await scoresFor(responseId) }, 201, headers);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
