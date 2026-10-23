/**
 * Level 2 — course creation.
 *
 * OpenMAIC exposes two hooks inside the transaction that creates a course.
 * They let us refuse a creation and record ownership atomically with the
 * course itself, which is why our tables had to live in the same database
 * (docs/LEVEL2_ARCHITECTURE_AUDIT.md section 9).
 *
 * `authorizeCreate` answers the instruction's "STUDENT … cannot create
 * courses"; `onCreate` answers "An instructor creating a course becomes its
 * OWNER."
 */
import type {
  CreateDecision,
  DocumentActor,
  PersistenceHooks,
  Queryable,
} from '@/lib/server/persistence-hooks';
import { authUserIdFromOwnerId } from './auth-method';
import { freeTitleNear } from './course-titles';
import type { Role } from './db';

async function profileFor(
  tx: Queryable,
  ownerId: string,
): Promise<{ id: string; role: Role; status: string } | undefined> {
  const authUserId = authUserIdFromOwnerId(ownerId);
  if (!authUserId) return undefined;
  const { rows } = await tx.query(
    `SELECT id, role, status FROM user_profiles WHERE auth_user_id = $1`,
    [authUserId],
  );
  return rows[0] as unknown as { id: string; role: Role; status: string } | undefined;
}

export const level2PersistenceHooks: PersistenceHooks = {
  name: 'level2-rbac',

  /**
   * Runs inside the create transaction. A refusal rolls the whole creation
   * back and answers 403 CREATE_REFUSED, so a student cannot leave a
   * half-created course behind.
   *
   * A background write is an agent run acting for an owner whose request has
   * already ended; the same rules apply, which is why it is not exempted.
   */
  async authorizeCreate(tx: Queryable, actor: DocumentActor): Promise<CreateDecision> {
    const profile = await profileFor(tx, actor.ownerId);
    if (!profile) return { allow: false, message: 'no active account for this owner' };
    if (profile.status !== 'ACTIVE')
      return { allow: false, message: `account is ${profile.status.toLowerCase()}` };
    if (profile.role === 'STUDENT') {
      return { allow: false, message: 'students may not create courses' };
    }
    return { allow: true };
  },

  /**
   * Same transaction, immediately after the creation was allowed. A throw here
   * rolls the course back too, so a course can never exist without the row
   * that says who owns it.
   *
   * The title is filled in later by the application: at this point OpenMAIC
   * has recorded the stage but the document the client is writing has not
   * necessarily been parsed, so a placeholder is honest and is corrected on
   * the first course listing.
   */
  async onCreate(tx: Queryable, actor: DocumentActor, stageId: string): Promise<void> {
    const profile = await profileFor(tx, actor.ownerId);
    if (!profile) throw new Error('level2: course created by an owner with no profile');

    // Titles are unique per owner since 2026-10-21, and this one is generated
    // rather than typed, so it is numbered until it is free. Failing a course
    // creation over a placeholder nobody chose would be absurd.
    const placeholder = await freeTitleNear(tx, profile.id, 'Untitled course');

    const { rows } = await tx.query(
      `INSERT INTO courses (openmaic_stage_id, title, owner_instructor_id, status)
       VALUES ($1, $2, $3, 'DRAFT')
       ON CONFLICT (openmaic_stage_id) DO NOTHING
       RETURNING id`,
      [stageId, placeholder, profile.id],
    );
    const courseId = (rows[0] as { id?: string } | undefined)?.id;
    if (!courseId) return; // lost a race with a concurrent create; the row exists

    await tx.query(
      `INSERT INTO course_instructors (course_id, instructor_id, permission, added_by)
       VALUES ($1, $2, 'OWNER', $2)
       ON CONFLICT (course_id, instructor_id) DO NOTHING`,
      [courseId, profile.id],
    );
  },
};
