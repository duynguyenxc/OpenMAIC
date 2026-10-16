/** Level 2 — who the current request is, for the dashboards to branch on. */
import { actorForOwner } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await actorForOwner(ownerId);
    if (!actor) return apiError(401, 'UNAUTHENTICATED', 'no active account', headers);
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT email, display_name, role, external_identifier, institution, status
         FROM user_profiles WHERE id = $1`,
      [actor.profileId],
    );
    const row = rows[0] as Record<string, unknown>;
    return json(
      {
        id: actor.profileId,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        externalIdentifier: row.external_identifier,
        institution: row.institution,
        status: row.status,
      },
      200,
      headers,
    );
  });
}
