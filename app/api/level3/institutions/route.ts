/** Level 3A — institutions. Listing: staff accounts. Creating: ADMIN. */
import { requireAuthenticatedUser } from '@/lib/level2/authorization';
import { requirePlatformAdmin } from '@/lib/level3/authorization';
import { level2Pool } from '@/lib/level2/db';
import { audit } from '@/lib/level3/audit';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);
    // Instructors and researchers need this list to fill in the selects that
    // place a course or a study. A student has no such select, and the roll of
    // institutions — who exists, how many people are in each — is not part of
    // taking a course. Refused rather than left open because it was convenient.
    if (actor.role === 'STUDENT') {
      return apiError(403, 'FORBIDDEN', 'institutions are not visible to students', headers);
    }
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT i.id, i.name, i.short_name AS "shortName", i.country,
              i.institution_type AS "institutionType", i.status,
              (SELECT count(*) FROM user_profiles up WHERE up.primary_institution_id = i.id) AS members,
              (SELECT count(*) FROM courses c WHERE c.institution_id = i.id) AS courses
         FROM institutions i ORDER BY i.name`,
    );
    return json({ institutions: rows }, 200, headers);
  });
}

export function POST(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requirePlatformAdmin(ownerId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const shortName = typeof body.shortName === 'string' ? body.shortName.trim() : '';
    if (!name || !shortName) {
      return apiError(400, 'NAME_REQUIRED', 'a name and a short name are required', headers);
    }

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `INSERT INTO institutions (name, short_name, country, institution_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lower(short_name)) DO NOTHING
       RETURNING id, name, short_name AS "shortName"`,
      [name, shortName, body.country ?? null, body.institutionType ?? null],
    );
    if (!rows[0]) {
      return apiError(409, 'SHORT_NAME_IN_USE', 'an institution with that short name exists', headers);
    }
    const created = rows[0] as { id: string; name: string };
    await audit({ profileId: actor.profileId }, 'INSTITUTION_CREATED', {
      type: 'institution', id: created.id,
    }, { name: created.name, shortName });
    return json(created, 201, headers);
  });
}
