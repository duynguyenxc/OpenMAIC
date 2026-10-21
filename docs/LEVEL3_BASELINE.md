# Level 3 — the baseline it is built on

**Recorded 2026-10-21 before any Level-3 code was written, as instruction v3 asks.**

Level 3 builds **on top of** Level 2. Nothing below may be broken by it, and this file is what a
later session compares against to find out whether something was.

| | |
|---|---|
| **Level-2 commit** | `0d01f563c832fc1363d1eb557062ae3047923268` — *Stop one instructor owning two courses with the same name* |
| **Level-2 tag** | `level2-multiuser-stable` |
| **Level-3 branch** | `feature/level3-research-platform` |
| **OpenMAIC upstream** | `8f7d51e5` (v1.1.1), `origin` still points at `THU-MAIC/OpenMAIC` |
| **Database schema version** | `db/migrations/0001_level2_rbac.sql`, `0002_unique_course_titles.sql` |
| **Authentication provider** | Supabase Auth, ES256 tokens verified against JWKS |
| **Database** | Supabase PostgreSQL, session pooler on 5432, TLS verified through `pg_stat_ssl` |
| **Deployment** | Vercel, `openmaic-level2.vercel.app` (Level 1 is a **separate** project and must not be touched) |

## Test results at this point

**58 passed, 0 failed** — `scripts/level2-security-tests.mjs`, run against both the local server
and the live deployment. The suite covers cross-course access, student impersonation, privilege
escalation, learner-data isolation, self-damage, repetition, boundary values, honest answers,
deletion and course naming.

Instruction v3 makes this a gate: *"Do not begin Level 3 unless Level 2 authentication, course
authorization, student-data isolation, and API security tests have passed."* They have.

## What Level 2 ends with, that Level 3 must not regress

- Accounts and three roles, with every permission enforced **server-side on every request**.
- One owner per course, who cannot be demoted or locked out of their own course.
- Students reach only courses they are enrolled in; learner identity is derived from the session
  and can never be supplied by the browser.
- Course deletion that archives rather than destroys whenever learner work exists.
- Course titles unique per owner.
- Seven upstream OpenMAIC files touched, all recorded in `docs/UPSTREAM_DELTA.md`.

## Known gaps carried into Level 3

- **Quiz and PBL records have never existed** in this deployment. Retrieval is kind-agnostic by
  construction, but that half of v2's item 14 rests on design rather than measurement, and it will
  stay that way until a course produces one.
- **Progress** is not shown on the student card; there is no data behind it.
- Level 1's deployment is separate and untested against Level-3 changes, by design.
