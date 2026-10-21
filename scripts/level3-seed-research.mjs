// Level 3A — the multi-institution fixture instruction v3 asks for.
//
//   Institution-US / Institution-UK / Institution-AU
//   Instructor-US  / Instructor-UK  / Instructor-AU
//   one template cloned into Course-US / Course-UK / Course-AU
//   different students in each, two experimental conditions
//
// Test-only credentials for fictitious @example.test addresses in our own
// Supabase project. Passwords are appended to .env.level2-test-accounts,
// which .gitignore excludes, and are never printed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

const INSTITUTIONS = [
  { short: 'US', name: 'Institution US', country: 'United States', type: 'UNIVERSITY' },
  { short: 'UK', name: 'Institution UK', country: 'United Kingdom', type: 'UNIVERSITY' },
  { short: 'AU', name: 'Institution AU', country: 'Australia',     type: 'UNIVERSITY' },
];

const ACCOUNTS = [
  { email: 'instructor-us@example.test', role: 'INSTRUCTOR', name: 'Instructor US', inst: 'US' },
  { email: 'instructor-uk@example.test', role: 'INSTRUCTOR', name: 'Instructor UK', inst: 'UK' },
  { email: 'instructor-au@example.test', role: 'INSTRUCTOR', name: 'Instructor AU', inst: 'AU' },
  { email: 'student-us@example.test', role: 'STUDENT', name: 'Student US', inst: 'US', ext: 'US-00001' },
  { email: 'student-uk@example.test', role: 'STUDENT', name: 'Student UK', inst: 'UK', ext: 'UK-00001' },
  { email: 'student-au@example.test', role: 'STUDENT', name: 'Student AU', inst: 'AU', ext: 'AU-00001' },
  { email: 'researcher@example.test', role: 'RESEARCHER', name: 'Test Researcher', inst: 'US' },
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

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

console.log('INSTITUTIONS');
const instIds = {};
for (const i of INSTITUTIONS) {
  const { rows } = await pool.query(
    `INSERT INTO institutions (name, short_name, country, institution_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (lower(short_name)) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [i.name, i.short, i.country, i.type],
  );
  instIds[i.short] = rows[0].id;
  console.log(`  ${i.short.padEnd(3)} ${i.name}`);
}

console.log('\nACCOUNTS');
const existing = await admin('/users?per_page=200');
const byEmail = new Map((existing.users ?? []).map((u) => [u.email, u]));
const lines = [];

for (const a of ACCOUNTS) {
  let user = byEmail.get(a.email);
  let password = null;
  if (!user) {
    password = `L3-${randomBytes(9).toString('base64url')}`;
    user = await admin('/users', {
      method: 'POST',
      body: JSON.stringify({ email: a.email, password, email_confirm: true }),
    });
  }
  await pool.query(
    `INSERT INTO user_profiles (auth_user_id, email, display_name, role, external_identifier,
                                status, primary_institution_id)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)
     ON CONFLICT (auth_user_id) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            role = EXCLUDED.role,
            external_identifier = EXCLUDED.external_identifier,
            status = 'ACTIVE',
            primary_institution_id = EXCLUDED.primary_institution_id`,
    [user.id, a.email, a.name, a.role, a.ext ?? null, instIds[a.inst]],
  );
  await pool.query(
    `INSERT INTO institution_memberships (institution_id, user_id, role)
     SELECT $1, up.id, $2 FROM user_profiles up WHERE up.auth_user_id = $3
     ON CONFLICT (institution_id, user_id) DO NOTHING`,
    [instIds[a.inst], a.role === 'STUDENT' ? 'MEMBER' : 'STAFF', user.id],
  );
  if (password) lines.push(`${a.email}=${password}`);
  console.log(`  ${a.role.padEnd(11)} ${a.email.padEnd(32)} ${a.inst}  ${password ? 'created' : 'already existed'}`);
}

if (lines.length) {
  const file = '.env.level2-test-accounts';
  const head = existsSync(file) ? readFileSync(file, 'utf8').trimEnd() + '\n' : '';
  writeFileSync(file, `${head}# Level 3 research fixture — test-only passwords.\n${lines.join('\n')}\n`);
  console.log(`\n  ${lines.length} new password(s) appended to ${file}`);
}

console.log('\nSTUDY');
const { rows: pi } = await pool.query(
  `SELECT id FROM user_profiles WHERE email = 'researcher@example.test'`);
const { rows: study } = await pool.query(
  `INSERT INTO studies (title, description, principal_investigator, protocol_identifier, status,
                        start_date)
   VALUES ($1, $2, $3, $4, 'ACTIVE', current_date)
   ON CONFLICT DO NOTHING
   RETURNING id`,
  [
    'Cross-institution comparison of agent conditions',
    'One instructional module run at three institutions under two agent conditions.',
    pi[0].id,
    'PROTO-2026-001',
  ],
);
let studyId = study[0]?.id;
if (!studyId) {
  const { rows } = await pool.query(
    `SELECT id FROM studies WHERE title = $1 LIMIT 1`,
    ['Cross-institution comparison of agent conditions']);
  studyId = rows[0].id;
}
await pool.query(
  `INSERT INTO study_researchers (study_id, user_id, role) VALUES ($1, $2, 'RESEARCHER')
   ON CONFLICT DO NOTHING`, [studyId, pi[0].id]);
console.log(`  study ${studyId}`);
console.log(`  principal investigator: researcher@example.test`);

await pool.end();
console.log('\nSeeded. Clone a template into each institution with scripts/level3-research-tests.mjs.');
