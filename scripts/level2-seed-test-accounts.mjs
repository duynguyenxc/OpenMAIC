// Level 2 — create the test accounts the instruction names, and their profiles.
// Test-only credentials for fictitious @example.test addresses in our own
// Supabase project. Passwords are written to .env.level2-test-accounts, which
// .gitignore already excludes; they are never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);

const SUPABASE_URL = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SECRET) throw new Error('Supabase URL or secret key missing from .env.local');

const ACCOUNTS = [
  { email: 'admin@example.test',       role: 'ADMIN',      name: 'Test Administrator' },
  { email: 'instructor1@example.test', role: 'INSTRUCTOR', name: 'Instructor One' },
  { email: 'instructor2@example.test', role: 'INSTRUCTOR', name: 'Instructor Two' },
  { email: 'student1@example.test',    role: 'STUDENT',    name: 'Student One',   ext: 'JSU-00001' },
  { email: 'student2@example.test',    role: 'STUDENT',    name: 'Student Two',   ext: 'JSU-00002' },
  { email: 'student3@example.test',    role: 'STUDENT',    name: 'Student Three', ext: 'JSU-00003' },
];

async function admin(path, init) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
}

const existing = await admin('/users?per_page=200');
const byEmail = new Map((existing.users ?? []).map((u) => [u.email, u]));

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const lines = ['# Level 2 test accounts — test-only passwords, never reuse elsewhere.'];

for (const account of ACCOUNTS) {
  let user = byEmail.get(account.email);
  let password = null;
  if (!user) {
    password = `T2-${randomBytes(9).toString('base64url')}`;
    user = await admin('/users', {
      method: 'POST',
      body: JSON.stringify({ email: account.email, password, email_confirm: true }),
    });
  }
  await pool.query(
    `INSERT INTO user_profiles (auth_user_id, email, display_name, role, external_identifier, status)
     VALUES ($1,$2,$3,$4,$5,'ACTIVE')
     ON CONFLICT (auth_user_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           role         = EXCLUDED.role,
           external_identifier = EXCLUDED.external_identifier,
           status       = 'ACTIVE'`,
    [user.id, account.email, account.name, account.role, account.ext ?? null],
  );
  lines.push(`${account.email}=${password ?? '(existing account, password unchanged)'}`);
  console.log(`  ${account.role.padEnd(10)} ${account.email}  ${password ? 'created' : 'already existed'}`);
}

writeFileSync('.env.level2-test-accounts', lines.join('\n') + '\n');
const { rows } = await pool.query('SELECT role, status, count(*) FROM user_profiles GROUP BY 1,2 ORDER BY 1');
console.log('\nuser_profiles:'); for (const r of rows) console.log(`  ${r.role} ${r.status}: ${r.count}`);
await pool.end();
