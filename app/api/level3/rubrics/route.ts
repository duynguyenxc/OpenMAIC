/**
 * Level 3B — rubrics.
 *
 * Versioned and immutable once published: a title at a version is one rubric
 * for ever, because *"Store rubric version used for each assessment"* is
 * meaningless if the rubric can be edited under a finished assessment. To
 * change one, publish a new version.
 */
import { requireAuthenticatedUser } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { audit } from '@/lib/level3/audit';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);
    if (actor.role === 'STUDENT') {
      return apiError(403, 'FORBIDDEN', 'rubrics are not visible to students', headers);
    }
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT r.id, r.title, r.version, r.description, r.status,
              up.email AS "createdByEmail", r.created_at AS "createdAt",
              (SELECT count(*) FROM rubric_dimensions d WHERE d.rubric_id = r.id) AS dimensions,
              (SELECT count(*) FROM assessments a WHERE a.rubric_id = r.id) AS "usedInAssessments"
         FROM rubrics r JOIN user_profiles up ON up.id = r.created_by
        WHERE r.status <> 'ARCHIVED' AND ($1 = 'ADMIN' OR r.created_by = $2 OR r.status = 'PUBLISHED')
        ORDER BY r.created_at DESC`,
      [actor.role, actor.profileId],
    );
    return json({ rubrics: rows }, 200, headers);
  });
}

export function POST(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);
    if (actor.role === 'STUDENT') {
      return apiError(403, 'FORBIDDEN', 'students cannot create rubrics', headers);
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return apiError(400, 'TITLE_REQUIRED', 'a rubric title is required', headers);

    const dimensions = Array.isArray(body.dimensions)
      ? (body.dimensions as Array<Record<string, unknown>>)
      : [];
    if (dimensions.length === 0) {
      return apiError(400, 'DIMENSIONS_REQUIRED', 'a rubric needs at least one dimension', headers);
    }
    const version =
      typeof body.version === 'string' && body.version.trim() ? body.version.trim() : '1.0';

    const pool = await level2Pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO rubrics (title, version, description, created_by, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (created_by, lower(title), version) DO NOTHING
         RETURNING id`,
        [
          title,
          version,
          body.description ?? null,
          actor.profileId,
          body.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
        ],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return apiError(
          409,
          'VERSION_EXISTS',
          'you already have a rubric with that title at that version; raise the version',
          headers,
        );
      }
      const rubricId = (rows[0] as { id: string }).id;

      for (const [index, d] of dimensions.entries()) {
        const dimensionId =
          typeof d.dimensionId === 'string' && d.dimensionId.trim()
            ? d.dimensionId.trim()
            : `d${index + 1}`;
        const maxScore = Number(d.maxScore);
        await client.query(
          `INSERT INTO rubric_dimensions (rubric_id, dimension_id, name, description, max_score, ordering)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            rubricId,
            dimensionId,
            String(d.name ?? dimensionId),
            d.description ?? null,
            Number.isFinite(maxScore) && maxScore > 0 ? Math.floor(maxScore) : 4,
            index,
          ],
        );
        for (const l of Array.isArray(d.levels)
          ? (d.levels as Array<Record<string, unknown>>)
          : []) {
          const score = Number(l.score);
          if (!Number.isFinite(score)) continue;
          await client.query(
            `INSERT INTO rubric_levels (rubric_id, dimension_id, score, descriptor)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [rubricId, dimensionId, Math.floor(score), String(l.descriptor ?? '')],
          );
        }
      }
      await client.query('COMMIT');
      await audit(
        { profileId: actor.profileId },
        'RUBRIC_CHANGED',
        { type: 'rubric', id: rubricId },
        { title, version, dimensions: dimensions.length },
      );
      return json({ id: rubricId, title, version, dimensions: dimensions.length }, 201, headers);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
