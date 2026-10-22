/** Level 3A — studies. Listing: what you are authorized to see. Creating: ADMIN. */
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
    if (actor.role === 'STUDENT') {
      return apiError(403, 'FORBIDDEN', 'studies are not visible to students', headers);
    }
    const pool = await level2Pool();
    // A researcher sees the studies they lead or were added to, and no others.
    // Holding the RESEARCHER role is not by itself access to anything.
    const { rows } = await pool.query(
      `SELECT s.id, s.title, s.description, s.status, s.protocol_identifier AS "protocolIdentifier",
              s.start_date AS "startDate", s.end_date AS "endDate",
              pi.email AS "principalInvestigator",
              (SELECT count(*) FROM study_courses sc WHERE sc.study_id = s.id) AS courses,
              (SELECT count(*) FROM research_participants rp WHERE rp.study_id = s.id) AS participants,
              (SELECT count(*) FROM research_participants rp
                WHERE rp.study_id = s.id AND rp.consent_status = 'CONSENTED') AS consented,
              (SELECT count(*) FROM research_events e WHERE e.study_id = s.id) AS events
         FROM studies s
         LEFT JOIN user_profiles pi ON pi.id = s.principal_investigator
         LEFT JOIN study_researchers sr ON sr.study_id = s.id AND sr.user_id = $2
        WHERE $1 = 'ADMIN' OR s.principal_investigator = $2 OR sr.user_id IS NOT NULL
        ORDER BY s.created_at DESC`,
      [actor.role, actor.profileId],
    );
    return json({ studies: rows }, 200, headers);
  });
}

export function POST(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requirePlatformAdmin(ownerId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return apiError(400, 'TITLE_REQUIRED', 'a study title is required', headers);

    const pool = await level2Pool();
    let piId: string | null = null;
    if (typeof body.principalInvestigator === 'string' && body.principalInvestigator.trim()) {
      const { rows } = await pool.query(
        `SELECT id, role FROM user_profiles WHERE lower(email) = lower($1)`,
        [body.principalInvestigator.trim()],
      );
      const candidate = rows[0] as { id?: string; role?: string } | undefined;
      piId = candidate?.id ?? null;
      if (!piId) return apiError(404, 'NO_SUCH_USER', 'no account with that email', headers);
      // Leading a study is read access to everybody else's data on it, so the
      // same rule applies here as to the studies list: a student never sees a
      // study, and naming one as investigator must not be the way around that.
      if (candidate?.role === 'STUDENT') {
        return apiError(
          409,
          'STUDENT_CANNOT_LEAD_STUDY',
          'that account is a student; a study is led by a researcher, instructor or administrator',
          headers,
        );
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO studies (title, description, principal_investigator, protocol_identifier,
                            status, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, status`,
      [
        title, body.description ?? null, piId, body.protocolIdentifier ?? null,
        typeof body.status === 'string' && ['DRAFT', 'ACTIVE', 'CLOSED'].includes(body.status)
          ? body.status : 'DRAFT',
        body.startDate ?? null, body.endDate ?? null,
      ],
    );
    const created = rows[0] as { id: string; title: string };
    await audit({ profileId: actor.profileId }, 'STUDY_CREATED',
      { type: 'study', id: created.id }, { title: created.title });
    return json(created, 201, headers);
  });
}
