/**
 * Level 3A — participants, and their consent.
 *
 * Registering a participant allocates P-00001 and nothing else: it does not
 * enrol anybody, and it does not consent on anybody's behalf. The default
 * state is NOT_REQUESTED, and an export excludes everything that is not
 * CONSENTED, because *"A student may need to use the educational platform
 * without automatically being included in research exports."*
 *
 * The listing shows emails, because an administrator registering participants
 * must know who they are registering. The **export** never does.
 */
import { requirePlatformAdmin, requireStudyAccess } from '@/lib/level3/authorization';
import { level2Pool } from '@/lib/level2/db';
import { audit } from '@/lib/level3/audit';
import { nextParticipantId } from '@/lib/level3/participants';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ studyId: string }> };
const CONSENT = new Set(['NOT_REQUESTED', 'PENDING', 'CONSENTED', 'DECLINED', 'WITHDRAWN']);

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { studyId } = await params;
    const actor = await requireStudyAccess(ownerId, studyId);
    const pool = await level2Pool();

    // Only an administrator or the study's own people see the link between a
    // person and their participant id; everyone else gets the id alone.
    const identified = actor.role === 'ADMIN';
    const { rows } = await pool.query(
      identified
        ? `SELECT rp.participant_id AS "participantId", rp.consent_status AS "consentStatus",
                  up.email, up.display_name AS "displayName", up.external_identifier AS "studentId",
                  rp.created_at AS "createdAt"
             FROM research_participants rp JOIN user_profiles up ON up.id = rp.user_id
            WHERE rp.study_id = $1 ORDER BY rp.participant_id`
        : `SELECT rp.participant_id AS "participantId", rp.consent_status AS "consentStatus",
                  rp.created_at AS "createdAt"
             FROM research_participants rp
            WHERE rp.study_id = $1 ORDER BY rp.participant_id`,
      [studyId],
    );
    return json({ participants: rows, identified }, 200, headers);
  });
}

/** Register one account as a participant, or change a consent state. */
export function POST(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { studyId } = await params;
    const actor = await requirePlatformAdmin(ownerId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!email) return apiError(400, 'EMAIL_REQUIRED', 'an account email is required', headers);

    const consent = typeof body.consentStatus === 'string' ? body.consentStatus : 'NOT_REQUESTED';
    if (!CONSENT.has(consent)) {
      return apiError(400, 'INVALID_CONSENT', 'unknown consent status', headers);
    }

    const pool = await level2Pool();
    const { rows: users } = await pool.query(
      `SELECT id, role FROM user_profiles WHERE lower(email) = lower($1)`, [email]);
    const user = users[0] as { id: string; role: string } | undefined;
    if (!user) return apiError(404, 'NO_SUCH_USER', 'no account with that email', headers);

    // Allocating a participant id has to be serialised, or two learners
    // entering a study at the same moment take the same number.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`participants:${studyId}`]);

      const { rows: existing } = await client.query(
        `SELECT participant_id AS "participantId" FROM research_participants
          WHERE study_id = $1 AND user_id = $2`,
        [studyId, user.id],
      );
      const participantId =
        (existing[0] as { participantId?: string } | undefined)?.participantId ??
        (await nextParticipantId(client, studyId));

      const { rows } = await client.query(
        `INSERT INTO research_participants (study_id, user_id, participant_id, consent_status,
                                            consent_recorded_at)
         VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'NOT_REQUESTED' THEN NULL ELSE now() END)
         ON CONFLICT (study_id, user_id)
           DO UPDATE SET consent_status = EXCLUDED.consent_status,
                         consent_recorded_at = EXCLUDED.consent_recorded_at
         RETURNING participant_id AS "participantId", consent_status AS "consentStatus"`,
        [studyId, user.id, participantId, consent],
      );
      await client.query('COMMIT');

      const saved = rows[0] as { participantId: string; consentStatus: string };
      // The audit row records the participant id, never the email: the log is
      // read by more people than the linkage table is.
      await audit({ profileId: actor.profileId }, 'CONSENT_CHANGED',
        { type: 'study', id: studyId },
        { participantId: saved.participantId, consentStatus: saved.consentStatus });
      return json(saved, 200, headers);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
