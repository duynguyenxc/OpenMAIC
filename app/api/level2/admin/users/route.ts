/**
 * Level 2 — administrator user management.
 *
 * The instruction is categorical: *"Never allow a normal user to change their
 * own role through a client request. Only ADMIN can change STUDENT ->
 * INSTRUCTOR, INSTRUCTOR -> ADMIN, etc."* requireAdmin is the only gate, and
 * an administrator may not change their own role either, so the last
 * administrator cannot accidentally demote themselves out of the platform.
 */
import { requireAdmin } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// RESEARCHER became a platform role in 3A — the database constraint admits it
// and the dashboard exists — but this Level-2 route was never told, so the
// dropdown offered an option the server refused and the only way to make a
// researcher was to run a seed script (O20).
const ROLES = new Set(['ADMIN', 'INSTRUCTOR', 'STUDENT', 'RESEARCHER']);
const STATUSES = new Set(['ACTIVE', 'INACTIVE', 'PENDING']);

export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    await requireAdmin(ownerId);
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT up.id, up.email, up.display_name AS "displayName", up.role, up.status,
              up.external_identifier AS "externalIdentifier",
              -- Two columns once meant "institution": a v2 free-text field and
              -- the Level-3 foreign key the platform actually decides sharing
              -- by. The key wins, and the text is a fallback for anything
              -- recorded before institutions existed.
              i.id                   AS "institutionId",
              COALESCE(i.name, up.institution) AS institution,
              i.short_name           AS "institutionShortName",
              up.created_at AS "createdAt"
         FROM user_profiles up
         LEFT JOIN institutions i ON i.id = up.primary_institution_id
        ORDER BY up.role, up.email`,
    );
    return json({ users: rows }, 200, headers);
  });
}

export function PATCH(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const admin = await requireAdmin(ownerId);
    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
      role?: unknown;
      status?: unknown;
      institution?: unknown;
      institutionId?: unknown;
    };
    if (typeof body.email !== 'string' || !body.email.trim()) {
      return apiError(400, 'EMAIL_REQUIRED', 'email is required', headers);
    }

    const updates: string[] = [];
    const values: unknown[] = [body.email.trim()];
    if (body.role !== undefined) {
      if (typeof body.role !== 'string' || !ROLES.has(body.role)) {
        return apiError(
          400,
          'INVALID_ROLE',
          'role must be ADMIN, INSTRUCTOR, STUDENT or RESEARCHER',
          headers,
        );
      }
      values.push(body.role);
      updates.push(`role = $${values.length}`);
    }
    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !STATUSES.has(body.status)) {
        return apiError(
          400,
          'INVALID_STATUS',
          'status must be ACTIVE, INACTIVE or PENDING',
          headers,
        );
      }
      values.push(body.status);
      updates.push(`status = $${values.length}`);
    }
    if (typeof body.institution === 'string') {
      values.push(body.institution);
      updates.push(`institution = $${values.length}`);
    }
    // Putting somebody in an institution had no route at all: only the Level-3
    // seed script set `primary_institution_id`, so an account created through
    // the product belonged to no institution and INSTITUTION-scoped sharing
    // could never reach it. An empty string clears the link.
    if (typeof body.institutionId === 'string') {
      const wanted = body.institutionId.trim();
      if (!wanted) {
        updates.push('primary_institution_id = NULL');
      } else {
        const pool0 = await level2Pool();
        const { rows: found } = await pool0.query(`SELECT id FROM institutions WHERE id = $1`, [
          wanted,
        ]);
        if (!found[0]) {
          return apiError(404, 'NO_SUCH_INSTITUTION', 'no institution with that id', headers);
        }
        values.push(wanted);
        updates.push(`primary_institution_id = $${values.length}`);
      }
    }
    if (!updates.length) return apiError(400, 'NOTHING_TO_UPDATE', 'no changes given', headers);

    const pool = await level2Pool();
    const { rows: target } = await pool.query(
      `SELECT id FROM user_profiles WHERE lower(email) = lower($1)`,
      [body.email.trim()],
    );
    const targetId = (target[0] as { id?: string } | undefined)?.id;
    if (!targetId) return apiError(404, 'NO_SUCH_USER', 'no account with that email', headers);
    if (targetId === admin.profileId && body.role !== undefined) {
      return apiError(
        400,
        'SELF_ROLE_CHANGE',
        'an administrator may not change their own role',
        headers,
      );
    }

    const { rows } = await pool.query(
      `UPDATE user_profiles SET ${updates.join(', ')}
        WHERE lower(email) = lower($1)
        RETURNING email, role, status, institution`,
      values,
    );
    return json(rows[0], 200, headers);
  });
}
