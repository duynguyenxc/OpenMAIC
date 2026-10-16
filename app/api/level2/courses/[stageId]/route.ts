/** Level 2 — course title and publication state. OWNER (or ADMIN) only. */
import { requireCourseOwner } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };

const STATUSES = new Set(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export function PATCH(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    await requireCourseOwner(ownerId, stageId);

    const body = (await req.json().catch(() => ({}))) as { title?: unknown; status?: unknown };
    const updates: string[] = [];
    const values: unknown[] = [stageId];

    if (typeof body.title === 'string' && body.title.trim()) {
      values.push(body.title.trim());
      updates.push(`title = $${values.length}`);
    }
    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !STATUSES.has(body.status)) {
        return apiError(400, 'INVALID_STATUS', 'status must be DRAFT, PUBLISHED or ARCHIVED', headers);
      }
      values.push(body.status);
      updates.push(`status = $${values.length}`);
    }
    if (!updates.length) return apiError(400, 'NOTHING_TO_UPDATE', 'no title or status given', headers);

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `UPDATE courses SET ${updates.join(', ')}
        WHERE openmaic_stage_id = $1
        RETURNING openmaic_stage_id AS "stageId", title, status`,
      values,
    );
    if (!rows[0]) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);
    return json(rows[0], 200, headers);
  });
}
