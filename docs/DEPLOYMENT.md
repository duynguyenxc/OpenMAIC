# Deployment

**Duy Nguyen · 21 October 2026**

## What is deployed where

| | URL | Project | What it is |
|---|---|---|---|
| **Level 1** | `openmaic-bice-five.vercel.app` | `openmaic` | OpenMAIC as published, deployed unmodified. **A separate Vercel project. Do not touch it.** |
| **Level 2 + 3A** | `openmaic-level2.vercel.app` | `openmaic-level2` | The platform. Currently serving Level 3A. |

Level 2's code is not lost by Level 3A being deployed: it is the tag `level2-multiuser-stable` and
the branch `feature/level2-rbac`, and `npx vercel --prod` from that branch restores it.

**Both platform levels share one Supabase database.** That is why Level 3A was promoted to
production rather than kept on a preview URL: the Level-2 build predates the `RESEARCHER` role and
answered `500` for that account once the role existed in the shared database. A genuinely separate
Level-3 deployment needs a database of its own to mean anything, which is a decision rather than a
command, and it is not made yet.

## Environment

All of it server-side. Nothing here is ever exposed to an instructor or a student.

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the Supabase project. Public by design, and the switch that turns accounts on |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the anon key. Public by design; RLS and revoked grants are what stand behind it |
| `SUPABASE_SECRET_KEY` | service role. **Server only.** Creating accounts, seeding |
| `DATABASE_URL` | Postgres, **session pooler on 5432** — not the transaction pooler on 6543 — with `uselibpqcompat=true` for node-postgres 8.22. TLS stays on; verified through `pg_stat_ssl` |
| `OPENAI_API_KEY` | the model provider. **Server only**, never sent to a browser |

Locally they live in `.env.local`; on Vercel they are project environment variables. Test account
passwords live in `.env.level2-test-accounts`, which `.gitignore` excludes.

## Migrations

Applied in order, each additive:

| File | What it adds |
|---|---|
| `db/migrations/0001_level2_rbac.sql` | `user_profiles`, `courses`, `course_instructors`, `enrollments` |
| `db/migrations/0002_unique_course_titles.sql` | one course name per owner |
| `db/migrations/0003_level3_research.sql` | institutions, templates, studies, participants, research events, audit log, the `RESEARCHER` role |

There is no migration runner. Each is applied once, deliberately, against the database:

```bash
node -e "const fs=require('fs'),{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query(fs.readFileSync('db/migrations/0003_level3_research.sql','utf8')).then(()=>p.end())"
```

**Nothing in 0002 or 0003 drops or rewrites a Level-2 table.** Every added column is nullable, so
the previous build keeps working against the new schema — with the one exception recorded above,
which is about a new *value* in `role`, not a new column.

## Deploying

```bash
npx vercel --prod --yes          # to openmaic-level2.vercel.app
npx vercel --yes                 # a preview URL — note it sits behind Vercel's deployment protection
```

Push to our fork explicitly rather than repointing `origin`, which stays on Tsinghua's repository so
upstream remains pullable:

```bash
git push https://github.com/duynguyenxc/OpenMAIC.git HEAD:feature/level3-research-platform
```

## Before and after any deployment

```bash
BASE_URL=https://openmaic-level2.vercel.app node scripts/level2-security-tests.mjs   # 58 checks
BASE_URL=https://openmaic-level2.vercel.app node scripts/level3-research-tests.mjs   # 46 checks
```

Both suites name their fixtures after the run and remove them afterwards, so they are safe to run
against the live site — which is the point, because *"Do not rely only on browser testing. Test
APIs directly."*

## Restoring Level 2

```bash
git checkout level2-multiuser-stable
npx vercel --prod --yes
```

The database keeps the Level-3 tables; they are additive and Level 2 ignores them. The one thing to
do first is move any `RESEARCHER` account to another role, for the reason given at the top.

## Known limits of this hosting

Free Vercel and free Supabase. Fine for a pilot class; **not** tested with many simultaneous
students, and nobody should assume it holds for hundreds. Long research work — projection, export —
runs on request and is cheap today because the datasets are small; at real size it belongs in a job
queue, which is noted rather than built.
