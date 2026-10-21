/**
 * Level 3C — knowledge resources.
 *
 * A resource is named, versioned and typed, and the type is what chooses the
 * retriever. Nothing here knows what a vector or a triple is.
 */
import { requireAuthenticatedUser } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { audit } from '@/lib/level3/audit';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TYPES = new Set(['DOCUMENT_COLLECTION', 'VECTOR_INDEX', 'KNOWLEDGE_GRAPH', 'STRUCTURED_DATA']);
const VISIBILITY = new Set(['PRIVATE', 'INSTITUTION', 'COMMUNITY', 'ADMIN_ONLY']);

export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);
    if (actor.role === 'STUDENT') {
      return apiError(403, 'FORBIDDEN', 'knowledge resources are not visible to students', headers);
    }
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT kr.id, kr.title, kr.description, kr.type, kr.version, kr.visibility, kr.status,
              up.email AS "ownerEmail", i.short_name AS institution, kr.created_at AS "createdAt",
              (SELECT count(*) FROM knowledge_documents d WHERE d.resource_id = kr.id) AS documents,
              (SELECT count(*) FROM knowledge_chunks c WHERE c.resource_id = kr.id) AS chunks,
              (SELECT count(*) FROM knowledge_chunks c
                WHERE c.resource_id = kr.id AND c.embedding IS NOT NULL) AS embedded,
              (SELECT count(*) FROM knowledge_graph_edges e WHERE e.resource_id = kr.id) AS edges
         FROM knowledge_resources kr
         JOIN user_profiles up ON up.id = kr.owner_id
         LEFT JOIN institutions i ON i.id = kr.institution_id
        WHERE kr.status <> 'ARCHIVED'
          AND ($1 = 'ADMIN' OR kr.owner_id = $2 OR kr.visibility = 'COMMUNITY'
               OR (kr.visibility = 'INSTITUTION' AND kr.institution_id IS NOT DISTINCT FROM
                   (SELECT primary_institution_id FROM user_profiles WHERE id = $2)))
        ORDER BY kr.created_at DESC`,
      [actor.role, actor.profileId],
    );
    return json({ resources: rows }, 200, headers);
  });
}

export function POST(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);
    if (actor.role === 'STUDENT') {
      return apiError(403, 'FORBIDDEN', 'students cannot create knowledge resources', headers);
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const type = typeof body.type === 'string' ? body.type : '';
    if (!title) return apiError(400, 'TITLE_REQUIRED', 'a title is required', headers);
    if (!TYPES.has(type)) {
      return apiError(400, 'INVALID_TYPE',
        'type must be DOCUMENT_COLLECTION, VECTOR_INDEX, KNOWLEDGE_GRAPH or STRUCTURED_DATA', headers);
    }
    const visibility = typeof body.visibility === 'string' ? body.visibility : 'PRIVATE';
    if (!VISIBILITY.has(visibility)) {
      return apiError(400, 'INVALID_VISIBILITY', 'unknown visibility', headers);
    }

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `INSERT INTO knowledge_resources (title, description, type, owner_id, institution_id,
                                        version, visibility, status, connection)
       VALUES ($1, $2, $3, $4,
               (SELECT primary_institution_id FROM user_profiles WHERE id = $4),
               $5, $6, 'PUBLISHED', $7)
       ON CONFLICT (owner_id, lower(title), version) DO NOTHING
       RETURNING id, title, type, version`,
      [title, body.description ?? null, type, actor.profileId,
       typeof body.version === 'string' && body.version.trim() ? body.version.trim() : '1.0',
       visibility,
       // A KNOWLEDGE_GRAPH resource can carry a remote service's connection
       // here; nothing above this layer interprets it.
       body.connection ?? null],
    );
    if (!rows[0]) {
      return apiError(409, 'VERSION_EXISTS', 'you already have a resource with that title at that version', headers);
    }
    const created = rows[0] as { id: string; title: string };
    await audit({ profileId: actor.profileId }, 'AGENT_CONFIGURATION_CHANGED',
      { type: 'knowledge_resource', id: created.id }, { title: created.title, resourceType: type });
    return json(created, 201, headers);
  });
}
