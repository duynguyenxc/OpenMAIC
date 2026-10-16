# Level 2 — Security Model

**Duy Nguyen · 2026-10-16**

How a request becomes an identity, how that identity becomes a permission, and where each decision
is made. Every claim here was checked by making the request, not by reading the code; the suite is
`scripts/level2-security-tests.mjs` (41 assertions, all passing).

---

## 1. Authentication — who is this?

```
browser                     server
  │                           │
  │ Supabase session cookie   │  lib/level2/session.ts
  ├──────────────────────────►│  getClaims() verifies the ES256 token
  │                           │  against the project's JWKS, locally
  │                           │
  │                           │  lib/level2/auth-method.ts
  │                           │  auth.users.id ──► ownerId = "user:<uuid>"
  │                           │  user_profiles ──► role, status
  │                           ▼
  │                      OwnerPrincipal { ownerId, kind, roles }
```

The method answers one of three things, and the difference matters:

| Answer | When | Result |
|---|---|---|
| `not-applicable` | no Supabase cookie at all | with the anonymous fallback off, the request is refused |
| `invalid` | a cookie that does not verify, or an account that is not ACTIVE | **401 at once**; no later method and no fallback is consulted |
| `authenticated` | verified token, ACTIVE profile | that principal owns the request |

A broken credential can therefore never quietly become a different identity.

**Tokens are ES256, not HS256.** This Supabase project publishes its public key at
`/auth/v1/.well-known/jwks.json`, so the legacy `SUPABASE_JWT_SECRET` cannot verify an access token.
Verification is local against the cached key set, so no request costs a round trip to the Auth
server.

**A first sign-in with no profile** is recorded as PENDING and then refused. The row exists only so
an administrator can see and approve the request; a pending account authenticates to nothing.

---

## 2. Learner identity — the browser cannot name itself

This is the property the instruction cares most about, and most of it predates us.

`app/api/persistence/[...path]/route.ts` hands the storage layer an `authenticate` callback that
**ignores the request path entirely** and returns the resolved owner:

```ts
authenticate: async (request) => {
  if (request.url?.startsWith('/assets')) return assetPrincipal;
  return { learnerKey: ownerId };
}
```

The enforcement lives in `@openmaic/storage`, *below* the application, so an application route that
forgets a check cannot bypass it.

Verified both directions, with two requests identical but for one field:

```
student 1 writes runtime for themselves  → 201 Created
student 1 writes runtime naming student 2 → 403 FORBIDDEN_LEARNER
```

Level 2 did not build this. It replaced the identity being isolated — an anonymous per-browser
cookie — with an authenticated account, and the isolation became per-student on its own.

---

## 3. Authorization — what may this identity do?

Every decision is in `lib/level2/authorization.ts`. The instruction is explicit that checks must not
be scattered and that *"UI hiding is not security"*.

| Helper | Grants |
|---|---|
| `requireAuthenticatedUser` | any ACTIVE account |
| `requireAdmin` | ADMIN only |
| `requireCourseInstructor` | OWNER, EDITOR or VIEWER on that course — or ADMIN |
| `requireCourseEditor` | OWNER or EDITOR — or ADMIN |
| `requireCourseOwner` | OWNER — or ADMIN |
| `requireCourseEnrollment` | ACTIVE enrolment **and** a PUBLISHED course |

ADMIN returns early from each, which is why "an administrator may inspect all course results" and
"enrol a student" need no separate administrative endpoints.

### The one core decision we changed

Upstream allows a course **read** to any valid owner holding the stage id — *"course reads are
capability-by-id"*. The instruction forbids that once accounts exist. `mayReadCourse` now admits
only: an administrator; an instructor listed on the course; a student with an ACTIVE enrolment in a
PUBLISHED course; or the stage's own OpenMAIC owner.

Measured before and after, on a course owned by instructor 1:

| Caller | Before | After |
|---|---|---|
| instructor 1 | 200 | 200 |
| administrator | 200 | 200 |
| instructor 2 | **200 — the whole document** | **403** |
| unenrolled student | **200 — the whole document** | **403** |
| no session | 200 | 401 |

### The student condition is compound, and each part was tested alone

| Enrolment | Course | Result |
|---|---|---|
| none | DRAFT | 403 |
| ACTIVE | DRAFT | **403** — publication is required |
| ACTIVE | PUBLISHED | 200 |
| INACTIVE | PUBLISHED | **403** — revocation takes effect on the next request |

---

## 4. Writes

| Action | Decided by | Refusal |
|---|---|---|
| Edit or delete a course document | `stage_meta.owner_id` in `@openmaic/storage` | 403 `FORBIDDEN_DOCUMENTS` |
| Create a course | `authorizeCreate` hook, inside the create transaction | 403 `CREATE_REFUSED` |
| Write another learner's runtime | `@openmaic/storage` | 403 `FORBIDDEN_LEARNER` |
| Change a role | `requireAdmin`, plus a refusal of self-change | 403, or 400 on self |

A refused creation **rolls the whole transaction back**: after a student's attempt there is no row
in `courses` and none in `stage_meta`. This is why our tables had to share OpenMAIC's database.

---

## 5. The shared access code is retired

At Level 1 `ACCESS_CODE` was the only protection, so it was essential. At Level 2 accounts
authorize, and a code every student would have to be told is friction rather than a control.
Verified after removing it that nothing was traded away:

```
no session → /api/level2/me 401 · /api/level2/courses 401
             /api/stages 401 · /api/persistence/documents/<id> 401
             /platform/login 200   (and only this)
```

The Level-1 deployment keeps its own code and is untouched.

---

## 6. Defence in depth, and what it is not

Row-level security is enabled on all four Level-2 tables with no policies, and `anon` and
`authenticated` are revoked. The application reaches them over a direct connection, so RLS does not
govern our own queries: it stops a browser holding the Supabase publishable key from reading those
tables through PostgREST. **It is a second fence, not the fence.** Authorization is server-side, in
the application.

---

## 7. Known weaknesses

Stated plainly rather than left to be discovered.

1. **TLS chain verification is relaxed on the database connection.** `sslmode=require` alone fails
   against Supabase under node-postgres 8.22, and `uselibpqcompat=true` restores libpq semantics —
   encrypted, chain not verified. Encryption was confirmed through `pg_stat_ssl`. Before real
   student data is stored, pin Supabase's CA with `sslrootcert`.
2. **No rate limiting on sign-in.** Supabase applies its own limits; the application adds none.
3. **No audit log.** Level 3 requires one; Level 2 does not have it.
4. **Quiz and PBL retrieval is unproven.** The mechanism is kind-agnostic and chat is verified end
   to end, but this deployment has never produced a quiz or PBL record, so that half of the
   instruction's "retrieve quiz/chat/PBL records" rests on the design rather than on a measurement.
