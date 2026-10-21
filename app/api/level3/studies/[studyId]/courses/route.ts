/**
 * Level 3A — which courses are in a study, and under which condition.
 *
 * Adding a course to a study does not change who may teach it or who is
 * enrolled: course authorization stays where Level 2 put it. It only says that
 * this section's events belong to this study, under this condition label.
 *
 * Condition labels are free text. The instruction lists examples —
 * CONTROL, AI_FEEDBACK, KG_BOUNDED_AGENT — and then says "Do not hard-code
 * these specific conditions. Allow researchers to define condition labels."
 */
import { requirePlatformAdmin, requireStudyAccess } from '@/lib/level3/authorization';
import { level2Pool } from '@/lib/level2/db';
import { audit } from '@/lib/level3/audit';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ studyId: string }> };

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { studyId } = await params;
    await requireStudyAccess(ownerId, studyId);
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT c.openmaic_stage_id AS "stageId", c.title, c.status,
              sc.experimental_condition AS "condition", sc.cohort_label AS "cohort",
              i.short_name AS institution,
              t.title AS "templateTitle", c.template_version AS "templateVersion",
              (c.configuration_snapshot IS NOT NULL) AS "hasSnapshot",
              (SELECT count(*) FROM enrollments e
                WHERE e.course_id = c.id AND e.status = 'ACTIVE') AS students,
              (SELECT count(*) FROM research_events re WHERE re.course_id = c.id) AS events
         FROM study_courses sc
         JOIN courses c ON c.id = sc.course_id
         LEFT JOIN institutions i ON i.id = c.institution_id
         LEFT JOIN course_templates t ON t.id = c.template_id
        WHERE sc.study_id = $1
        ORDER BY i.short_name NULLS LAST, c.title`,
      [studyId],
    );
    return json({ courses: rows }, 200, headers);
  });
}

export function POST(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { studyId } = await params;
    const actor = await requirePlatformAdmin(ownerId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const stageId = typeof body.stageId === 'string' ? body.stageId.trim() : '';
    if (!stageId) return apiError(400, 'COURSE_REQUIRED', 'a course is required', headers);

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `INSERT INTO study_courses (study_id, course_id, experimental_condition, cohort_label)
       SELECT $1, c.id, $3, $4 FROM courses c WHERE c.openmaic_stage_id = $2
       ON CONFLICT (study_id, course_id)
         DO UPDATE SET experimental_condition = EXCLUDED.experimental_condition,
                       cohort_label = EXCLUDED.cohort_label
       RETURNING course_id`,
      [studyId, stageId, body.condition ?? null, body.cohort ?? null],
    );
    if (!rows[0]) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);

    await audit({ profileId: actor.profileId }, 'STUDY_COURSE_ADDED',
      { type: 'study', id: studyId },
      { course: stageId, condition: body.condition ?? null, cohort: body.cohort ?? null });
    return json({ studyId, stageId, condition: body.condition ?? null }, 200, headers);
  });
}
