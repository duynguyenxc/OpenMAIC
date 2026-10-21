/**
 * Level 2 — database access for the identity and authorization tables.
 *
 * These tables live in the same database as OpenMAIC's own, so this module
 * deliberately borrows OpenMAIC's pool instead of opening a second one: the
 * provider is cached per connection string, so asking for it again returns the
 * same pool rather than doubling the connection count against Postgres.
 */
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

/**
 * RESEARCHER arrived with Level 3A. It is a platform role with **no course
 * permission at all**: a researcher reads de-identified study data and never
 * becomes a teacher by holding it, which instruction v3 states outright —
 * "Researcher should NOT automatically be able to modify courses."
 */
export type Role = 'ADMIN' | 'INSTRUCTOR' | 'STUDENT' | 'RESEARCHER';
export type AccountStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING';

export interface UserProfile {
  id: string;
  authUserId: string;
  email: string;
  displayName: string | null;
  role: Role;
  externalIdentifier: string | null;
  institution: string | null;
  status: AccountStatus;
}

function connectionString(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('level2: DATABASE_URL is not set');
  return value;
}

/** OpenMAIC's pool. Shared on purpose; see the module comment. */
export async function level2Pool() {
  const { pool } = await getServerPersistenceProvider(connectionString());
  return pool;
}

interface ProfileRow {
  id: string;
  auth_user_id: string;
  email: string;
  display_name: string | null;
  role: Role;
  external_identifier: string | null;
  institution: string | null;
  status: AccountStatus;
}

function toProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    externalIdentifier: row.external_identifier,
    institution: row.institution,
    status: row.status,
  };
}

const PROFILE_COLUMNS =
  'id, auth_user_id, email, display_name, role, external_identifier, institution, status';

export async function findProfileByAuthUserId(authUserId: string): Promise<UserProfile | undefined> {
  const pool = await level2Pool();
  const { rows } = await pool.query<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS} FROM user_profiles WHERE auth_user_id = $1`,
    [authUserId],
  );
  return rows[0] ? toProfile(rows[0]) : undefined;
}

/**
 * First sign-in of an account an administrator has not provisioned.
 *
 * The instruction allows either admin-created accounts or self-registration
 * held at PENDING until an administrator approves; this implements the second
 * without granting anything. A PENDING profile authenticates to nothing: the
 * auth method refuses it, so the row exists only so an administrator can see
 * the request and act on it.
 *
 * ON CONFLICT DO NOTHING, then re-read: two concurrent first requests from the
 * same new account must not raise, and must not create two profiles.
 */
export async function ensurePendingProfile(
  authUserId: string,
  email: string,
): Promise<UserProfile | undefined> {
  const pool = await level2Pool();
  await pool.query(
    `INSERT INTO user_profiles (auth_user_id, email, role, status)
     VALUES ($1, $2, 'STUDENT', 'PENDING')
     ON CONFLICT (auth_user_id) DO NOTHING`,
    [authUserId, email],
  );
  return findProfileByAuthUserId(authUserId);
}
