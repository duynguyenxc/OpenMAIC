/**
 * Level 2 — central authorization.
 *
 * The instruction is explicit that authorization must be implemented once and
 * reused: *"Do not scatter random role checks throughout UI code … Every
 * sensitive server/API route must use these checks. UI hiding is not
 * security."* Every decision in Level 2 is answered here.
 *
 * All functions take the OpenMAIC owner id (`user:<auth_user_id>`), because
 * that is what the identity layer resolves for a request, and translate it to
 * a profile themselves.
 */
import { authUserIdFromOwnerId } from './auth-method';
import { level2Pool, type Role, type UserProfile } from './db';

export type CoursePermission = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface Actor {
  readonly profileId: string;
  readonly authUserId: string;
  readonly ownerId: string;
  readonly role: Role;
}

/** The signed-in account behind an owner id, or undefined if there is none active. */
export async function actorForOwner(ownerId: string | undefined): Promise<Actor | undefined> {
  if (!ownerId) return undefined;
  const authUserId = authUserIdFromOwnerId(ownerId);
  if (!authUserId) return undefined;
  const pool = await level2Pool();
  const { rows } = await pool.query<{ id: string; role: Role; status: string }>(
    `SELECT id, role, status FROM user_profiles WHERE auth_user_id = $1`,
    [authUserId],
  );
  const row = rows[0];
  if (!row || row.status !== 'ACTIVE') return undefined;
  return { profileId: row.id, authUserId, ownerId, role: row.role };
}

export class AuthorizationError extends Error {
  constructor(
    readonly status: 401 | 403 | 404,
    readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'COURSE_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export async function requireAuthenticatedUser(ownerId: string | undefined): Promise<Actor> {
  const actor = await actorForOwner(ownerId);
  if (!actor) throw new AuthorizationError(401, 'UNAUTHENTICATED', 'authentication required');
  return actor;
}

export async function requireAdmin(ownerId: string | undefined): Promise<Actor> {
  const actor = await requireAuthenticatedUser(ownerId);
  if (actor.role !== 'ADMIN') {
    throw new AuthorizationError(403, 'FORBIDDEN', 'administrator role required');
  }
  return actor;
}

/** The actor's permission on a course identified by its OpenMAIC stage id. */
export async function coursePermission(
  actor: Actor,
  stageId: string,
): Promise<CoursePermission | undefined> {
  const pool = await level2Pool();
  const { rows } = await pool.query<{ permission: CoursePermission }>(
    `SELECT ci.permission
       FROM course_instructors ci
       JOIN courses c ON c.id = ci.course_id
      WHERE c.openmaic_stage_id = $1 AND ci.instructor_id = $2`,
    [stageId, actor.profileId],
  );
  return rows[0]?.permission;
}

/** An ACTIVE enrolment in a PUBLISHED course — both conditions, as the instruction states. */
export async function hasActiveEnrollment(actor: Actor, stageId: string): Promise<boolean> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `SELECT 1
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
      WHERE c.openmaic_stage_id = $1
        AND e.student_id = $2
        AND e.status = 'ACTIVE'
        AND c.status = 'PUBLISHED'`,
    [stageId, actor.profileId],
  );
  return rows.length > 0;
}

/**
 * Does this course exist at all?
 *
 * Every permission check below answers "no" the same way whether the course
 * belongs to somebody else or was never there, so an owner who mistyped an id,
 * or opened a link to a course that has since been deleted, was told
 * "course owner permission required" (O14). That sends them looking for a
 * permission problem they do not have.
 *
 * The trade is that a 404 confirms an id is unused. Stage ids are ten random
 * characters, so that tells an enumerator nothing they could act on, and every
 * other route in the product already answers 404 for a course that is gone.
 */
async function courseExists(stageId: string): Promise<boolean> {
  const pool = await level2Pool();
  const { rows } = await pool.query(`SELECT 1 FROM courses WHERE openmaic_stage_id = $1 LIMIT 1`, [
    stageId,
  ]);
  return rows.length > 0;
}

/** Raise 404 rather than 403 when the course simply is not there. */
async function refuse(stageId: string, message: string): Promise<never> {
  if (!(await courseExists(stageId))) {
    throw new AuthorizationError(404, 'COURSE_NOT_FOUND', 'no such course');
  }
  throw new AuthorizationError(403, 'FORBIDDEN', message);
}

/** Any instructor permission on the course (OWNER, EDITOR or VIEWER), or ADMIN. */
export async function requireCourseInstructor(
  ownerId: string | undefined,
  stageId: string,
): Promise<Actor> {
  const actor = await requireAuthenticatedUser(ownerId);
  if (actor.role === 'ADMIN') return actor;
  const permission = await coursePermission(actor, stageId);
  if (!permission) await refuse(stageId, 'not an instructor of this course');
  return actor;
}

/** OWNER or EDITOR — may change instructional content. VIEWER may not. */
export async function requireCourseEditor(
  ownerId: string | undefined,
  stageId: string,
): Promise<Actor> {
  const actor = await requireAuthenticatedUser(ownerId);
  if (actor.role === 'ADMIN') return actor;
  const permission = await coursePermission(actor, stageId);
  if (permission !== 'OWNER' && permission !== 'EDITOR') {
    await refuse(stageId, 'edit permission required for this course');
  }
  return actor;
}

/** OWNER only — add or remove co-instructors, publish, delete. */
export async function requireCourseOwner(
  ownerId: string | undefined,
  stageId: string,
): Promise<Actor> {
  const actor = await requireAuthenticatedUser(ownerId);
  if (actor.role === 'ADMIN') return actor;
  if ((await coursePermission(actor, stageId)) !== 'OWNER') {
    await refuse(stageId, 'course owner permission required');
  }
  return actor;
}

export async function requireCourseEnrollment(
  ownerId: string | undefined,
  stageId: string,
): Promise<Actor> {
  const actor = await requireAuthenticatedUser(ownerId);
  if (!(await hasActiveEnrollment(actor, stageId))) {
    await refuse(stageId, 'not enrolled in this course');
  }
  return actor;
}

/**
 * May this owner read this course?
 *
 * This is the one decision the audit found missing: OpenMAIC allows a read to
 * any valid owner holding the id, which the instruction forbids once Level 2
 * exists (*"Do NOT use knowledge of a course ID alone as sufficient
 * authorization"*).
 *
 * Permitted: an administrator; any instructor listed on the course; a student
 * with an ACTIVE enrolment in a PUBLISHED course; and the OpenMAIC owner of
 * the stage itself, which covers the moment between a course being created
 * and its `courses` row being visible.
 */
export async function mayReadCourse(
  ownerId: string | undefined,
  stageId: string,
): Promise<boolean> {
  const actor = await actorForOwner(ownerId);
  if (!actor) return false;
  if (actor.role === 'ADMIN') return true;
  if (await coursePermission(actor, stageId)) return true;
  if (await hasActiveEnrollment(actor, stageId)) return true;

  const pool = await level2Pool();
  const { rows } = await pool.query(
    `SELECT 1 FROM stage_meta WHERE stage_id = $1 AND owner_id = $2`,
    [stageId, ownerId],
  );
  return rows.length > 0;
}

/** Whether Level-2 course authorization is active at all. */
export function courseAuthorizationEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL);
}

export type { UserProfile };
