# Measured limits, and a production architecture

**Duy Nguyen · 22 October 2026**

Instruction v3 asks for two things this document answers: *"Identify practical limits of the chosen
free/low-cost hosting"* and, at completion, a *"recommended production deployment architecture"*.

Reproduce the measurements with:

```bash
CONCURRENCY=6 ROUNDS=3 node scripts/level3-load-check.mjs
```

It defaults to the local server deliberately — see "A note on measuring the deployment" below.

## What was measured

Six simultaneous requests, three rounds, against the application and the database it uses.

| What | median | p90 | outcome |
|---|---|---|---|
| sign-in page, unauthenticated | 74 ms | 163 ms | all succeeded |
| student dashboard data | 1,013 ms | 3,708 ms | all succeeded |
| identity check (`/me`) | 891 ms | 1,560 ms | all succeeded |
| course results (joins and counts) | 2,641 ms | 5,593 ms | **6 of 18 failed** |
| direct database round trip | 533 ms | 659 ms | all succeeded |
| runtime-record write | 1,072 ms | 1,331 ms | all succeeded |
| upload request path | 687 ms | 2,583 ms | **6 of 18 failed** |

## The limit, named

```
(EMAXCONNSESSION) max clients reached in session mode — pool_size: 15
```

**Supabase's session-mode pooler caps at fifteen clients in total**, shared between the application
and anything else connected. At six concurrent requests it was already exhausted, and every failure
above is that — not application logic, not a query, not the models.

This is the first thing that breaks on this hosting, and it breaks **before** anything else gets a
chance to.

### Why we are on the session pooler at all

Level 2 chose port **5432 (session mode)** over 6543 (transaction mode) because node-postgres needed
`uselibpqcompat=true` to connect at all. That choice has since acquired a second dependency worth
naming: `app/api/level2/courses/[stageId]/duplicate/route.ts` holds a **session-level advisory
lock** (`pg_advisory_lock`) to stop a double click creating two courses. Transaction-mode pooling
does not keep a session across statements, so that lock would silently stop working.

Everything else uses `pg_advisory_xact_lock`, which is transaction-scoped and survives the move.
So the migration is one known change, not an unknown one.

## A note on measuring the deployment

Running the same burst against the live URL produced a different and misleading answer: every
request came back `403` with `x-vercel-mitigated: challenge`. That is the host's own bot protection
refusing a burst from a single address — **not the application failing**. A browser solves the
challenge automatically; a script does not, so the automated suites were locked out of production
for a while afterwards while a human visitor was unaffected throughout.

The load script now detects that header and reports it as a hosting fact rather than counting it as
a defect, and defaults to the local server so nobody provokes it by accident.

## What to expect first, in order

1. **Database connections** — fifteen, shared. Reached at single-digit concurrency.
2. **Edge bot mitigation** — triggered by bursts from one address, which includes any automated
   testing against production.
3. **Function concurrency** on the free plan.
4. **Model rate limits** on assessment, feedback and handwriting — the only calls here measured in
   seconds rather than milliseconds, and the only ones that cost money.

**Nothing here establishes behaviour at a hundred students**, and the instruction is explicit that
prototype hosting must not be assumed suitable for them.

## Recommended production architecture

```
                 Browser
                    |
            CDN / edge (TLS, WAF)
                    |
        Application (containers, N replicas)      ← Dockerfile already in the repo
          |                 |              |
   Auth provider      PostgreSQL      Object storage
   (Supabase or        (primary +      (uploads; today they are bytea)
    self-hosted)       read replica)
          |
   Job workers (separate replicas, same image)    ← drain processing_jobs
          |
   External services: model provider, ASR, optional vector/graph service
```

Changes from the prototype, each with its reason:

| Change | Why |
|---|---|
| ~~**Transaction-mode pooling, or PgBouncer with a real pool size**~~ — **done 29 Oct 2026** | the measured limit above. Both session-level advisory locks were replaced; see the section at the end of this document |
| **Uploads to object storage** | `response_media.bytes` is `bytea`; a cohort's recordings do not belong in a row |
| **Job workers as their own replicas** | the queue is drained by an HTTP route today, so nobody drains it unless someone calls it |
| **A scheduler** | transcription and projection should run without being asked |
| **Read replica for analytics and export** | the slowest query measured is a researcher's, and it should not compete with a classroom |
| **Verify the database certificate chain** | `uselibpqcompat` is a known shortcut, recorded since Level 2 |
| **Separate database per deployment level** | Level 2 and Level 3 currently share one, which is how a role added for Level 3 briefly broke the Level-2 build |
| **Model rate limiting and a budget ceiling** | `model_usage` records spending; nothing yet stops it |

### What should not change

The parts that are load-bearing and correct: authorization on the server for every request,
learner identity derived from the session, the projection reading OpenMAIC's records rather than
writing beside them, and research instrumentation staying off the teaching path — which is what
lets any of the above be replaced without touching a classroom.

---

## The pool that took the deployment down (27 October 2026)

Every route touching the database began answering 500 on the live deployment. The sign-in page
loaded, Supabase accepted the password, and `/api/level2/me` could not read the profile — which
from the outside is indistinguishable from the application being down.

**The cause was the pool size, and it was never set.** `lib/persistence/server-provider.ts` built
the pool with `new Pool({ connectionString })` and `pg` defaults to **ten** connections. One Node
server is fine with that. A serverless deployment is not: each warm instance holds its own pool,
and Supabase's session-mode pooler admits **fifteen clients in total**, so two warm instances can
claim twenty and everything past the fifteenth is refused with `EMAXCONNSESSION`.

It had survived because there was rarely more than one warm instance. That is luck, not a design,
and it fails exactly when more than one person uses the platform — which is the condition the
platform exists for.

Now sized for where it runs: `max: 2` and a ten-second idle timeout under Vercel or Lambda, the
former ten elsewhere. A serverless invocation serves one request, so two is ample and leaves room
for the other instances, the test suites, and anyone debugging with `psql`.

Measured against the live deployment after the change:

| Concurrent requests to `/api/level2/courses` | Result |
|---|---|
| 5 | 5 OK, 0 failures (2,946 ms — cold start) |
| 10 | 10 OK, 0 failures (730 ms) |
| 20 | 20 OK, 0 failures (670 ms) |

### What is still true

The ceiling is still fifteen session-mode clients, and it is still the first thing that breaks
here. Two things make it worse, both avoidable:

- **Running `npm run dev` against the same database while the deployment is in use.** A dev server
  holds its own pool of up to ten; it took the live site down on 23 October exactly this way.
- Running the test suites locally at the same time, for the same reason.

The real headroom is Supabase's **transaction pooler on port 6543**, which admits hundreds. Moving
there breaks the one session-scoped advisory lock in this codebase — the duplicate guard in
`app/api/level2/courses/[stageId]/duplicate`, which uses `pg_advisory_lock` where everything else
uses the transaction-scoped variant. One known change, with a known cost. It is the right next step
before any real cohort uses this, and the wrong thing to attempt during an outage.

---

## The move to the transaction pooler (29 October 2026)

The `max: 2` cap recorded above did **not** fix the outage. It slowed it down. Seventeen hours
later the deployment was refusing every database-backed request again, with no dev server running
anywhere, and the previous entry's claim that the problem was solved was wrong.

Reading `pg_stat_activity` through a borrowed slot showed what was holding the pooler:

```
application_name   state   n
Supavisor          idle    15     ← every client session-mode admits
```

Those belong to **frozen Vercel instances**. Serverless freezes a lambda between requests rather
than ending it, so `idleTimeoutMillis` never fires and the connection is held until the instance is
finally reclaimed — which can be hours. A cap on pool size cannot help: the connections are not in
use, they are abandoned, and in session mode an abandoned client still occupies its slot.

### What changed

`DATABASE_URL` now points at **port 6543**, Supabase's transaction pooler, where a connection
returns to the pool after every transaction. A frozen instance holds nothing, and the ceiling is
hundreds of clients rather than fifteen.

Two session-scoped advisory locks had to go first, because transaction pooling makes them unsound —
the lock outlives its work, on a backend another client is now using:

- `lib/persistence/schema-bootstrap-lock.ts` now takes `pg_advisory_xact_lock` inside a transaction
  on its own client. Postgres runs DDL transactionally, so nothing is lost and a bootstrap that
  fails half way no longer leaves half a schema.
- The duplicate guard in `app/api/level2/courses/[stageId]/duplicate` could not be converted
  directly: it held its lock across `store.saveDocument`, which runs on the storage layer's own
  connections. It now has a transaction-scoped lock around the lookup, and relies on
  `courses_owner_title_unique` for the guarantee — two requests past the lookup pick the same free
  title, the database refuses the second, and that refusal is answered with the copy the winner
  made. **The guarantee comes from the database rather than from a lock held across an `await`.**

### Measured after the change, against the live deployment

| Concurrent requests | Result |
|---|---|
| 10 | 10 OK, 0 failures (3,768 ms — cold start) |
| 30 | 30 OK, 0 failures (652 ms) |
| 60 | 60 OK, 0 failures (2,062 ms) |

Connections held afterwards: **9**, where session mode had been stuck at its ceiling of 15.

All five API suites pass against the live deployment on the new pooler: 83 + 59 + 42 + 35 + 42 =
**261 checks, 0 failures**.

### What is still true

- Local development now uses 6543 too (`.env.local`; the old value is kept at
  `.env.local.bak-5432`, which is gitignored). A dev server can no longer starve the deployment.
- `max: 2` under serverless stays. It costs nothing and is still the right size for an invocation
  that serves one request.
- Transaction mode does not support session-level state. **Any future `pg_advisory_lock`,
  `SET LOCAL`-free session settings, `LISTEN/NOTIFY` or server-side prepared statement across
  requests will silently misbehave.** `pg_advisory_xact_lock` is the pattern to reach for; the
  three Level-3 routes already used it.
