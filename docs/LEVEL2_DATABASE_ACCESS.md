# Level 2 — Where the data lives, and how to look at it

**Duy Nguyen · 2026-10-16**

Three things exist, and it matters which is which.

| | What it is | Written by | Use it for |
|---|---|---|---|
| **Live database** | Supabase PostgreSQL 17 | the application | the real data |
| **Local backups** | `db/backups/*.dump` | `scripts/level2-db-backup.sh` | keeping a copy on this machine |
| **Local mirror** | PostgreSQL 18 database `openmaic_mirror` | `scripts/level2-db-mirror.sh` | reading offline, experimenting safely |

The mirror is never what the application writes to. That is deliberate: a second writable copy would
quietly become a second source of truth.

---

## Why the live database is not simply on this machine

Two reasons, both structural rather than preference:

1. **The staging deployment has to reach it.** The instruction requires Level 2 to be deployed to a
   separate staging URL. A Vercel function runs in Vercel's network and cannot open a connection to
   a laptop.
2. **`user_profiles.auth_user_id` references `auth.users`**, which is Supabase's own table. Supabase
   Auth issues the sessions; its user table has to be in the same database for that foreign key to
   mean anything.

So the live database is Supabase, and everything is copied down here instead.

---

## Keeping a copy on this machine

```bash
cd ~/Downloads/OpenMAIC
./scripts/level2-db-backup.sh
```

Dumps **everything** — OpenMAIC's 17 tables, our 4, and the 27-table `auth` schema — into
`db/backups/openmaic-<timestamp>.dump`. The ten most recent are kept.

> These dumps contain password hashes and session rows. `db/backups/` is gitignored. Treat the files
> as credentials.

Then load the newest backup into a local database:

```bash
./scripts/level2-db-mirror.sh
```

It drops and recreates `public` and `auth` in `openmaic_mirror`, so a second restore is a clean
snapshot rather than two moments in time merged together.

---

## Looking at the data

### A browser UI

```bash
./scripts/level2-db-viewer.sh      # starts Adminer at http://localhost:8080
docker rm -f openmaic-db-viewer    # stops it
```

Adminer runs in a container, so nothing is installed on the machine. The script prints the
connection details for the **live** database.

Two things that will otherwise waste your time:

- **Use the pooler host**, `aws-0-…​.pooler.supabase.com:5432`, not `db.<ref>.supabase.co`. The
  direct name resolves only over IPv6 and a container cannot reach it.
- **The username is `postgres.<project-ref>`**, not `postgres`, on the pooler.

### The mirror, from the terminal

Adminer refuses the local server because this machine's PostgreSQL trusts any password over TCP.
Rather than change `pg_hba.conf` — which the realist-synthesis project also depends on — read the
mirror with `psql`:

```bash
psql -U postgres -d openmaic_mirror

\dt                               -- our four tables and OpenMAIC's seventeen
\dt auth.*                        -- Supabase's auth schema
SELECT email, role, status FROM user_profiles ORDER BY role;
SELECT openmaic_stage_id, title, status FROM courses;
```

A read-only role exists for tools that want one: `openmaic_viewer`, credentials in
`.env.level2-db-viewer` (gitignored). It can read every table and write none — verified by trying.

---

## What is where

```
public schema (21 tables)
├── OpenMAIC, 17 tables     document_stages · document_scenes · document_outlines
│                           runtime_sessions · runtime_records · stage_meta
│                           asset_* · owner_* · legacy_import_bindings
└── Level 2, 4 tables       user_profiles · courses · course_instructors · enrollments

auth schema (27 tables)     Supabase Auth: users, sessions, refresh tokens, identities
```

The join between the two halves is the owner id: `stage_meta.owner_id` and
`runtime_sessions.learner_key` both hold `user:<auth_user_id>`, so a learner's interaction records
can be attributed to an account with a single join and nothing is duplicated.

---

## Worth knowing

**Connection strings need `uselibpqcompat=true`.** Without it, node-postgres 8.22 reads
`sslmode=require` as "verify the chain" and refuses Supabase's certificate with
`SELF_SIGNED_CERT_IN_CHAIN`. Encryption was confirmed through `pg_stat_ssl` afterwards, so this
restores libpq semantics rather than disabling TLS. Before real student data is stored, pinning
Supabase's CA with `sslrootcert` would be stronger.

**Use port 5432, not 6543.** The 6543 pooler is transaction-mode and breaks the session-scoped
features OpenMAIC relies on.
