/**
 * Level 3 — the administrative audit log.
 *
 * Append-only: nothing in this application updates or deletes a row. The
 * instruction names the actions it wants recorded and one thing it does not
 * want recorded at all — "Do not log passwords, access tokens, or API keys" —
 * so `metadata` is written by the caller from named fields rather than by
 * spreading a request body into it.
 *
 * Writing an audit row must never be the reason an action fails. A log that
 * can break the thing it watches gets removed the first time it does.
 */
import { level2Pool } from '@/lib/level2/db';

export type AuditAction =
  | 'USER_CREATED'
  | 'ROLE_CHANGED'
  | 'COURSE_CREATED'
  | 'COURSE_DELETED'
  | 'COURSE_ARCHIVED'
  | 'TEMPLATE_PUBLISHED'
  | 'TEMPLATE_CLONED'
  | 'STUDENT_ENROLLED'
  | 'STUDENT_REMOVED'
  | 'INSTITUTION_CREATED'
  | 'STUDY_CREATED'
  | 'STUDY_COURSE_ADDED'
  | 'CONSENT_CHANGED'
  | 'DATA_EXPORTED';

export async function audit(
  actor: { profileId?: string; email?: string } | null,
  action: AuditAction,
  target: { type: string; id: string },
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const pool = await level2Pool();
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_email, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actor?.profileId ?? null, actor?.email ?? null, action, target.type, target.id, metadata],
    );
  } catch (error) {
    // Deliberately swallowed, and deliberately noisy in the server log.
    console.error('[level3] audit write failed', action, error);
  }
}
