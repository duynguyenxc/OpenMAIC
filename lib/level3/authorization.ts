/**
 * Level 3 — who may see research data.
 *
 * Course authorization stays authoritative, exactly as the instruction insists:
 * *"Do not infer permissions solely from institution membership."* Belonging to
 * an institution groups people; it never opens a course. Everything here is a
 * second, narrower question — may this person see **this study's** data — and
 * it never widens what Level 2 decided.
 *
 * A researcher is not a teacher. *"Researcher should NOT automatically be able
 * to modify courses."* Nothing in this file grants course access, and the
 * RESEARCHER role has no course permission anywhere in the platform.
 */
import {
  AuthorizationError,
  requireAuthenticatedUser,
  type Actor,
} from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';

export type StudyRole = 'RESEARCHER' | 'DATA_MANAGER' | 'OBSERVER';

/** Platform administration: institutions, studies, roles, exports policy. */
export async function requirePlatformAdmin(ownerId: string | undefined): Promise<Actor> {
  const actor = await requireAuthenticatedUser(ownerId);
  if (actor.role !== 'ADMIN') {
    throw new AuthorizationError(403, 'FORBIDDEN', 'administrator permission required');
  }
  return actor;
}

/**
 * Access to one study's data: an administrator, the principal investigator, or
 * someone explicitly listed on it. Membership of the same institution is not
 * enough, and neither is holding the RESEARCHER role in general — a researcher
 * sees only the studies they were added to.
 */
export async function requireStudyAccess(
  ownerId: string | undefined,
  studyId: string,
  minimum: StudyRole[] = ['RESEARCHER', 'DATA_MANAGER', 'OBSERVER'],
): Promise<Actor> {
  const actor = await requireAuthenticatedUser(ownerId);
  if (actor.role === 'ADMIN') return actor;
  // The studies list already refuses students; so does every route behind this
  // check, and for the same reason. Said once here, it cannot be undone by a
  // row — a student named as principal investigator is still a student.
  if (actor.role === 'STUDENT') {
    throw new AuthorizationError(403, 'FORBIDDEN', 'studies are not visible to students');
  }

  const pool = await level2Pool();
  const { rows } = await pool.query(
    `SELECT 1
       FROM studies s
       LEFT JOIN study_researchers sr
         ON sr.study_id = s.id AND sr.user_id = $2 AND sr.role = ANY($3::text[])
      WHERE s.id = $1
        AND (s.principal_investigator = $2 OR sr.user_id IS NOT NULL)`,
    [studyId, actor.profileId, minimum],
  );
  if (!rows[0]) {
    throw new AuthorizationError(403, 'FORBIDDEN', 'not authorized for this study');
  }
  return actor;
}

/** Exporting is narrower than reading: a viewer of a study cannot take it away. */
export async function requireExportPermission(
  ownerId: string | undefined,
  studyId: string,
): Promise<Actor> {
  return requireStudyAccess(ownerId, studyId, ['RESEARCHER', 'DATA_MANAGER']);
}

/** The studies this person may open at all, for their own dashboard. */
export async function studiesVisibleTo(actor: Actor): Promise<string[]> {
  const pool = await level2Pool();
  const { rows } =
    actor.role === 'ADMIN'
      ? await pool.query(`SELECT id FROM studies ORDER BY created_at DESC`)
      : await pool.query(
          `SELECT DISTINCT s.id
             FROM studies s
             LEFT JOIN study_researchers sr ON sr.study_id = s.id AND sr.user_id = $1
            WHERE s.principal_investigator = $1 OR sr.user_id IS NOT NULL
            ORDER BY s.id`,
          [actor.profileId],
        );
  return (rows as Array<{ id: string }>).map((r) => r.id);
}
