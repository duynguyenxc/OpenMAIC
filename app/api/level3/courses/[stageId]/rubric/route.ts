/**
 * Level 3B — attach a rubric to an activity, and set its feedback policy.
 *
 * Per course **and** activity, which is what makes a study possible: the same
 * module, the same rubric, and a different feedback policy in each condition.
 */
import { requireCourseInstructor, requireCourseOwner } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { audit } from '@/lib/level3/audit';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };
const POLICIES = new Set(['OFF', 'ON', 'AFTER_FIRST_RESPONSE', 'AFTER_SUBMISSION', 'ON_REQUEST']);

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    await requireCourseInstructor(ownerId, stageId);
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT ra.activity_id AS "activityId", ra.rubric_id AS "rubricId",
              ra.rubric_version AS "rubricVersion", ra.feedback_policy AS "feedbackPolicy",
              r.title AS "rubricTitle"
         FROM rubric_assignments ra
         JOIN courses c ON c.id = ra.course_id
         JOIN rubrics r ON r.id = ra.rubric_id
        WHERE c.openmaic_stage_id = $1
        ORDER BY ra.activity_id`,
      [stageId],
    );
    return json({ assignments: rows }, 200, headers);
  });
}

export function POST(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    const actor = await requireCourseOwner(ownerId, stageId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const activityId = typeof body.activityId === 'string' ? body.activityId.trim() : '';
    const rubricId = typeof body.rubricId === 'string' ? body.rubricId : '';
    if (!activityId || !rubricId) {
      return apiError(
        400,
        'ACTIVITY_AND_RUBRIC_REQUIRED',
        'an activity and a rubric are required',
        headers,
      );
    }
    const policy = typeof body.feedbackPolicy === 'string' ? body.feedbackPolicy : 'ON_REQUEST';
    if (!POLICIES.has(policy)) {
      return apiError(
        400,
        'INVALID_POLICY',
        'feedback policy must be OFF, ON, AFTER_FIRST_RESPONSE, AFTER_SUBMISSION or ON_REQUEST',
        headers,
      );
    }

    const pool = await level2Pool();
    const { rows: rubricRows } = await pool.query(`SELECT version FROM rubrics WHERE id = $1`, [
      rubricId,
    ]);
    const rubric = rubricRows[0] as { version: string } | undefined;
    if (!rubric) return apiError(404, 'RUBRIC_NOT_FOUND', 'no such rubric', headers);

    // The version is copied, not referenced, so the assignment keeps pointing
    // at the design it was made with even if a newer version is published.
    const { rows } = await pool.query(
      `INSERT INTO rubric_assignments (course_id, activity_id, rubric_id, rubric_version,
                                       feedback_policy, created_by)
       SELECT c.id, $2, $3, $4, $5, $6 FROM courses c WHERE c.openmaic_stage_id = $1
       ON CONFLICT (course_id, activity_id)
         DO UPDATE SET rubric_id = EXCLUDED.rubric_id,
                       rubric_version = EXCLUDED.rubric_version,
                       feedback_policy = EXCLUDED.feedback_policy
       RETURNING id`,
      [stageId, activityId, rubricId, rubric.version, policy, actor.profileId],
    );
    if (!rows[0]) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);

    await audit(
      { profileId: actor.profileId },
      'RUBRIC_ATTACHED',
      { type: 'course', id: stageId },
      { activityId, rubricId, rubricVersion: rubric.version, feedbackPolicy: policy },
    );
    return json(
      { activityId, rubricId, rubricVersion: rubric.version, feedbackPolicy: policy },
      200,
      headers,
    );
  });
}
