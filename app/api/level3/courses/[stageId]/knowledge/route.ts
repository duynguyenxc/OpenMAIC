/**
 * Level 3C — attach knowledge sources to a course.
 *
 * *"Each source should have: name; role; priority; retrieval policy;
 * citation/provenance metadata."* and *"Do not hard-code the labels K1 and K2
 * into the generic platform."*
 *
 * So the instructor names the source. `authoritative`, `counterpoint`, `K1` —
 * the platform stores the label, orders by priority, and never interprets
 * either. Several sources at once is the normal case.
 */
import { requireCourseInstructor, requireCourseOwner } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { sourcesForCourse } from '@/lib/level3/knowledge';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    await requireCourseInstructor(ownerId, stageId);
    return json({ sources: await sourcesForCourse(stageId) }, 200, headers);
  });
}

export function POST(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    const actor = await requireCourseOwner(ownerId, stageId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const resourceId = typeof body.resourceId === 'string' ? body.resourceId : '';
    const sourceName = typeof body.sourceName === 'string' ? body.sourceName.trim() : '';
    if (!resourceId || !sourceName) {
      return apiError(400, 'SOURCE_REQUIRED', 'a resource and a source name are required', headers);
    }

    const pool = await level2Pool();
    const { rows: res } = await pool.query(
      `SELECT id FROM knowledge_resources WHERE id = $1 AND status <> 'ARCHIVED'`,
      [resourceId],
    );
    if (!res[0]) return apiError(404, 'RESOURCE_NOT_FOUND', 'no such resource', headers);

    const { rows } = await pool.query(
      `INSERT INTO knowledge_attachments
         (resource_id, scope, scope_id, source_name, source_role, priority, retrieval_policy, created_by)
       VALUES ($1, 'COURSE', $2, $3, $4, $5, $6, $7)
       ON CONFLICT (scope, scope_id, source_name)
         DO UPDATE SET resource_id = EXCLUDED.resource_id,
                       source_role = EXCLUDED.source_role,
                       priority = EXCLUDED.priority,
                       retrieval_policy = EXCLUDED.retrieval_policy
       RETURNING id, source_name AS "sourceName", priority`,
      [
        resourceId,
        stageId,
        sourceName,
        body.sourceRole ?? null,
        Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100,
        body.retrievalPolicy ?? null,
        actor.profileId,
      ],
    );
    return json(rows[0], 200, headers);
  });
}

export function DELETE(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    await requireCourseOwner(ownerId, stageId);
    const sourceName = new URL(req.url).searchParams.get('sourceName');
    if (!sourceName) return apiError(400, 'SOURCE_REQUIRED', 'sourceName is required', headers);
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `DELETE FROM knowledge_attachments
        WHERE scope = 'COURSE' AND scope_id = $1 AND source_name = $2
        RETURNING source_name AS "sourceName"`,
      [stageId, sourceName],
    );
    if (!rows[0]) return apiError(404, 'NOT_ATTACHED', 'that source is not attached here', headers);
    return json({ removed: sourceName }, 200, headers);
  });
}
