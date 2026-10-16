/**
 * Level 2 — the owner auth method.
 *
 * This is the whole of "replace client-controlled identity with authenticated
 * server identity". OpenMAIC resolves an owner once per request through
 * `lib/server/identity/`, and every owner-scoped table, document and runtime
 * partition is keyed by whatever this returns. Registering one method
 * therefore converts the platform from one-owner-per-browser to
 * one-owner-per-account without editing a single route: the isolation the
 * storage layer already enforces (403 FORBIDDEN_DOCUMENTS, 403
 * FORBIDDEN_LEARNER) becomes per-student isolation on its own.
 *
 * See docs/LEVEL2_ARCHITECTURE_AUDIT.md sections 3 and 4.
 */
import type { OwnerAuthMethod, OwnerAuthMethodResult } from '@/lib/server/identity';
import { OWNER_ROLES } from '@/lib/server/identity';
import { ensurePendingProfile, findProfileByAuthUserId, type Role } from './db';
import { readSession } from './session';

/** The owner id namespace this method mints. */
export const OWNER_PREFIX = 'user:';

export function ownerIdForAuthUser(authUserId: string): string {
  return `${OWNER_PREFIX}${authUserId}`;
}

export function authUserIdFromOwnerId(ownerId: string): string | undefined {
  return ownerId.startsWith(OWNER_PREFIX) ? ownerId.slice(OWNER_PREFIX.length) : undefined;
}

/**
 * Core roles granted per application role.
 *
 * OpenMAIC authorizes on `roles`, never on the shape of the id, so the
 * mapping is the whole of what the core knows about our roles:
 *
 * - `course:publish` lets an owner publish a course. Instructors and
 *   administrators may; a student may not, which is one half of "STUDENT
 *   cannot publish course".
 * - `admin` is reserved by core for administrative surfaces and granted by no
 *   built-in method. Granting it to ADMIN is what makes the platform
 *   administrator an administrator to OpenMAIC as well.
 *
 * Course-level authorization (who may read or edit *which* course) is not
 * expressible here and is enforced separately; this is the platform-wide part.
 */
function coreRoles(role: Role): ReadonlySet<string> {
  switch (role) {
    case 'ADMIN':
      return new Set([OWNER_ROLES.admin, OWNER_ROLES.coursePublish]);
    case 'INSTRUCTOR':
      return new Set([OWNER_ROLES.coursePublish]);
    case 'STUDENT':
      return new Set<string>();
  }
}

export function supabaseOwnerAuthMethod(): OwnerAuthMethod {
  return {
    name: 'level2-supabase-session',

    async authenticate(req): Promise<OwnerAuthMethodResult> {
      const outcome = await readSession(req.headers);

      // No credential of our kind. Core asks the next method; with the
      // anonymous fallback off, the request is refused.
      if (outcome.kind === 'none') return { status: 'not-applicable' };

      // A present but broken credential must never quietly become a different
      // identity, so this is `invalid`, not `not-applicable`.
      if (outcome.kind === 'invalid') return { status: 'invalid', reason: outcome.reason };

      const { userId, email } = outcome.claims;

      // A verified account with no profile is a first sign-in. Record it as
      // PENDING so an administrator can see and approve it, and refuse the
      // request: a pending account is authenticated but not yet admitted.
      const profile =
        (await findProfileByAuthUserId(userId)) ?? (await ensurePendingProfile(userId, email));

      if (!profile) return { status: 'invalid', reason: 'account profile could not be resolved' };
      if (profile.status !== 'ACTIVE') {
        return { status: 'invalid', reason: `account is ${profile.status.toLowerCase()}` };
      }

      return {
        status: 'authenticated',
        principal: {
          ownerId: ownerIdForAuthUser(userId),
          kind: 'user',
          roles: coreRoles(profile.role),
          assurance: 'verified',
          channel: 'web',
        },
      };
    },

    /**
     * Describe an id this method minted, for work that holds only the stored
     * id. Roles are omitted: they live in `user_profiles` and may change, and
     * the contract asks for what the id *always* carries.
     */
    describeStoredOwner(ownerId) {
      return authUserIdFromOwnerId(ownerId) === undefined
        ? undefined
        : { kind: 'user' as const };
    },
  };
}
