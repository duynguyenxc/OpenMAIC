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
| **Transaction-mode pooling, or PgBouncer with a real pool size** | the measured limit above. Requires replacing the one session-level advisory lock |
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
