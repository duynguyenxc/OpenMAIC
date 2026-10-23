/**
 * Level 3A — course templates.
 *
 * A template publishes an existing course's instructional design so that other
 * instructors can run it. What a reader sees is governed by `visibility`, and
 * a template is never a grant of access to the course it came from.
 */
import { requireAuthenticatedUser } from '@/lib/level2/authorization';
import { requireCourseInstructor } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { audit } from '@/lib/level3/audit';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VISIBILITY = new Set(['PRIVATE', 'INSTITUTION', 'COMMUNITY', 'ADMIN_ONLY']);

/** What this account may see: their own, their institution's, the community's. */
export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);
    // Students do not browse template libraries — the instruction says so in
    // as many words — and nothing here is useful to them anyway.
    if (actor.role === 'STUDENT') {
      return apiError(403, 'FORBIDDEN', 'templates are not for students', headers);
    }
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.description, t.version, t.visibility, t.status,
              t.discipline, t.tags, t.source_stage_id AS "sourceStageId",
              t.created_at AS "createdAt",
              up.email AS "createdByEmail", up.display_name AS "createdByName",
              i.short_name AS "institution",
              (SELECT count(*) FROM courses c WHERE c.template_id = t.id) AS "clonedInto"
         FROM course_templates t
         JOIN user_profiles up ON up.id = t.created_by
         LEFT JOIN institutions i ON i.id = t.institution_id
        WHERE t.status <> 'ARCHIVED'
          AND ($1 = 'ADMIN'
               OR t.created_by = $2
               OR t.visibility = 'COMMUNITY'
               OR (t.visibility = 'INSTITUTION' AND t.institution_id IS NOT DISTINCT FROM
                   (SELECT primary_institution_id FROM user_profiles WHERE id = $2)))
        ORDER BY t.created_at DESC`,
      [actor.role, actor.profileId],
    );
    return json({ templates: rows }, 200, headers);
  });
}

/** Publish one of your own courses as a template. */
export function POST(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const stageId = typeof body.stageId === 'string' ? body.stageId : '';
    if (!stageId) return apiError(400, 'STAGE_REQUIRED', 'a course is required', headers);

    // You may only publish a course you are entitled to. ADMIN passes here too.
    await requireCourseInstructor(ownerId, stageId);

    const visibility = typeof body.visibility === 'string' ? body.visibility : 'PRIVATE';
    if (!VISIBILITY.has(visibility)) {
      return apiError(
        400,
        'INVALID_VISIBILITY',
        'visibility must be PRIVATE, INSTITUTION, COMMUNITY or ADMIN_ONLY',
        headers,
      );
    }
    const version =
      typeof body.version === 'string' && body.version.trim() ? body.version.trim() : '1.0';

    const pool = await level2Pool();
    const { rows: courseRows } = await pool.query(
      `SELECT id, title FROM courses WHERE openmaic_stage_id = $1`,
      [stageId],
    );
    const course = courseRows[0] as { id: string; title: string } | undefined;
    if (!course) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);

    const title =
      typeof body.title === 'string' && body.title.trim() ? body.title.trim() : course.title;

    const { rows } = await pool.query(
      `INSERT INTO course_templates
         (title, description, source_course_id, source_stage_id, version, created_by,
          institution_id, visibility, status, discipline, tags)
       VALUES ($1, $2, $3, $4, $5, $6,
               (SELECT primary_institution_id FROM user_profiles WHERE id = $6),
               $7, 'PUBLISHED', $8, $9)
       ON CONFLICT (created_by, lower(title), version) DO NOTHING
       RETURNING id, title, version, visibility`,
      [
        title,
        body.description ?? null,
        course.id,
        stageId,
        version,
        actor.profileId,
        visibility,
        body.discipline ?? null,
        Array.isArray(body.tags) ? body.tags : null,
      ],
    );
    if (!rows[0]) {
      return apiError(
        409,
        'VERSION_EXISTS',
        'you already published that title at that version; raise the version',
        headers,
      );
    }
    const created = rows[0] as { id: string; title: string; version: string };
    await audit(
      { profileId: actor.profileId },
      'TEMPLATE_PUBLISHED',
      { type: 'template', id: created.id },
      { title: created.title, version: created.version, visibility, fromCourse: stageId },
    );
    return json(created, 201, headers);
  });
}
