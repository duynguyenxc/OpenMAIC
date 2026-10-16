# Upstream Delta — what Level 2 changed in OpenMAIC's own files

**Duy Nguyen · 2026-10-16 · against `8f7d51e5` (OpenMAIC v1.1.1)**

The instruction asks for the files changed from Level 1, and for upstream to remain updatable.
Nearly all of Level 2 is **new files**; the list below is everything that touches code OpenMAIC
maintains.

```
 .gitignore                             |  10 +++
 app/api/persistence/[...path]/route.ts |  15 ++++
 components/access-code-guard.tsx       |  45 ++++++------
 instrumentation.ts                     |  31 +++++++++
 package.json                           |   6 +-
 pnpm-lock.yaml                         | 122 ++++++++++++++++++++++++++++-----
 6 files changed, 191 insertions(+), 38 deletions(-)
```

---

## Each change, and why it could not be avoided

### 1. `instrumentation.ts` — registration

Registers the owner auth method and the persistence hooks. Both are OpenMAIC's own documented
extension points (`configureOwnerAuthentication`, `configurePersistenceHooks`), and the README
states that `register()` is where a host wires them. There is no other place to do it.

**Conditional on Supabase being configured**, so the same build still runs as the Level-1 pilot
where it is not.

**Merge risk: low.** Additive, in a function designed for host registration.

### 2. `app/api/persistence/[...path]/route.ts` — course read authorization

Fifteen lines that consult `mayReadCourse` when the action is a read. Upstream allows a read to
any valid owner holding the stage id; the instruction forbids that once accounts exist.

There is **no hook for reads** — the persistence hooks cover create, library listing and asset
admission only — so this is the one decision that had to be edited rather than extended. The logic
lives in `lib/level2/authorization.ts`; the route only asks. It is a no-op when Level 2 is not
configured.

**Merge risk: low to moderate.** A small, clearly delimited block; an upstream refactor of the
access decision would need it moved, not rewritten.

### 3. `components/access-code-guard.tsx` — the Level-1 fix

Holds children until the access gate resolves. Opening a classroom link while unauthenticated
showed `DocumentStore HTTP request failed with status 401` and needed a manual Retry, because the
page issued its data requests before any cookie existed.

Carried over from Level 1, where it was approved by the project owner.

**Merge risk: low.** One component, behaviour unchanged when no code is set.

### 4. `.gitignore` — admit the documentation

Upstream ignores `/docs`, but the instruction names `docs/ADMIN_MANUAL.md`,
`docs/LEVEL2_DATABASE_SCHEMA.md` and others by path. A negation admits exactly those.

**Merge risk: none.**

### 5. `package.json`, `pnpm-lock.yaml` — two dependencies

`@supabase/ssr` and `@supabase/supabase-js`, for reading the session server-side and signing in
from the browser.

**Merge risk: low.**

---

## Everything else is new

```
lib/level2/            identity, authorization, database access, results
app/api/level2/        the platform API
app/platform/          sign-in and the three dashboards
components/level2/     the shared dashboard frame
db/migrations/         the four Level-2 tables
scripts/level2-*       seeding, security tests, backup, mirror, viewer
docs/                  this file and the rest
```

None of it is reachable from upstream code: OpenMAIC calls into it only through the two
registrations in `instrumentation.ts`.

---

## Keeping upstream updatable

`upstream` still points at `THU-MAIC/OpenMAIC`; `git fetch upstream` works. A future merge
touches the four files above, three of which are a handful of lines each.

Tag `level1-classroom-pilot` marks the working Level-1 state, so the two can always be compared.
