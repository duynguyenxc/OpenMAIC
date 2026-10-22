/**
 * Level 3 — the retention policy, and what it would cover.
 *
 * *"Make retention configurable"* and, in the next breath, *"Do not
 * permanently delete records automatically without explicit policy."*
 *
 * So this endpoint sets a policy and **shows what it would affect**. Nothing
 * here deletes anything, and no scheduled task acts on these numbers. A
 * research dataset destroyed overnight by a timer nobody remembered setting is
 * exactly the failure the instruction is guarding against.
 */
import { requirePlatformAdmin } from '@/lib/level3/authorization';
import { level2Pool } from '@/lib/level2/db';
import { audit } from '@/lib/level3/audit';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HANDLING = new Set(['RETAIN_DEIDENTIFIED', 'RETAIN_IDENTIFIED', 'PURGE_ON_REQUEST']);
const STRATEGY = new Set(['PARTICIPANT_ID_ONLY', 'HASH_IDENTIFIERS', 'FULL_ANONYMISE']);

/** What the current policy would cover, if anybody acted on it. */
async function coverage(policy: { instructional_days: number | null; research_days: number | null }) {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM learner_responses
         WHERE $1::int IS NOT NULL AND submitted_at < now() - ($1 || ' days')::interval) AS "instructionalResponses",
       (SELECT count(*)::int FROM runtime_sessions
         WHERE $1::int IS NOT NULL AND created_at::timestamptz < now() - ($1 || ' days')::interval) AS "instructionalSessions",
       (SELECT count(*)::int FROM research_events
         WHERE $2::int IS NOT NULL AND event_timestamp < now() - ($2 || ' days')::interval) AS "researchEvents",
       (SELECT count(*)::int FROM response_media
         WHERE $1::int IS NOT NULL AND created_at < now() - ($1 || ' days')::interval) AS "uploads"`,
    [policy.instructional_days, policy.research_days],
  );
  return rows[0];
}

export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    await requirePlatformAdmin(ownerId);
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT instructional_days AS "instructionalDays", research_days AS "researchDays",
              deleted_account_handling AS "deletedAccountHandling",
              deidentification_strategy AS "deidentificationStrategy",
              notes, updated_at AS "updatedAt"
         FROM retention_policy WHERE id = true`,
    );
    const policy = rows[0] as Record<string, unknown>;
    const would = await coverage({
      instructional_days: policy.instructionalDays as number | null,
      research_days: policy.researchDays as number | null,
    });
    return json(
      {
        policy,
        wouldCover: would,
        enforcement:
          'None. This policy is recorded and reported; nothing in the platform deletes on a ' +
          'timer. Acting on it is a deliberate, separate operation.',
      },
      200,
      headers,
    );
  });
}

export function PATCH(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requirePlatformAdmin(ownerId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const days = (v: unknown) =>
      v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : undefined;

    const instructional = days(body.instructionalDays);
    const research = days(body.researchDays);
    if (instructional === undefined || research === undefined) {
      return apiError(400, 'INVALID_PERIOD', 'a retention period must be a positive number of days, or null to keep indefinitely', headers);
    }
    if (body.deletedAccountHandling !== undefined && !HANDLING.has(String(body.deletedAccountHandling))) {
      return apiError(400, 'INVALID_HANDLING', 'unknown deleted-account handling', headers);
    }
    if (body.deidentificationStrategy !== undefined && !STRATEGY.has(String(body.deidentificationStrategy))) {
      return apiError(400, 'INVALID_STRATEGY', 'unknown de-identification strategy', headers);
    }

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `UPDATE retention_policy
          SET instructional_days = $1,
              research_days = $2,
              deleted_account_handling = COALESCE($3, deleted_account_handling),
              deidentification_strategy = COALESCE($4, deidentification_strategy),
              notes = COALESCE($5, notes),
              updated_by = $6,
              updated_at = now()
        WHERE id = true
        RETURNING instructional_days AS "instructionalDays", research_days AS "researchDays",
                  deleted_account_handling AS "deletedAccountHandling",
                  deidentification_strategy AS "deidentificationStrategy"`,
      [instructional, research, body.deletedAccountHandling ?? null,
       body.deidentificationStrategy ?? null, body.notes ?? null, actor.profileId],
    );
    const policy = rows[0] as Record<string, unknown>;
    await audit({ profileId: actor.profileId }, 'ROLE_CHANGED',
      { type: 'retention_policy', id: 'singleton' }, policy);

    return json(
      {
        policy,
        wouldCover: await coverage({
          instructional_days: policy.instructionalDays as number | null,
          research_days: policy.researchDays as number | null,
        }),
        enforcement: 'Recorded. Nothing was deleted, and nothing will be deleted automatically.',
      },
      200,
      headers,
    );
  });
}
