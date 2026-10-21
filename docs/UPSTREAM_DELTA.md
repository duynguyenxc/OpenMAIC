# Upstream Delta — what Level 2 changed in OpenMAIC's own files

**Duy Nguyen · 2026-10-16 · against `8f7d51e5` (OpenMAIC v1.1.1)**

The instruction asks for the files changed from Level 1, and for upstream to remain updatable.
Nearly all of Level 2 is **new files**; the list below is everything that touches code OpenMAIC
maintains.

```
 .gitignore                                |  14 ++++
 app/api/persistence/[...path]/route.ts    |  15 ++++
 app/page.tsx                              |   6 ++
 components/access-code-guard.tsx          | 114 +++++++++++++++++++++++-----
 components/classroom/ClassroomSurface.tsx |  68 ++++++++++++-----
 instrumentation.ts                        |  31 ++++++++
 package.json                              |   6 +-
 pnpm-lock.yaml                            | 122 ++++++++++++++++++++++++++----
 8 files changed, 319 insertions(+), 57 deletions(-)
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

### 3. `components/access-code-guard.tsx` — the Level-1 fix, and the sign-in redirect

Two changes live here.

The first is carried over from Level 1, where it was approved by the project owner: hold the
children until the access gate resolves. Opening a classroom link while unauthenticated showed
`DocumentStore HTTP request failed with status 401` and needed a manual Retry, because the page
issued its data requests before any cookie existed.

The second was found by the project owner on 16 October, on the deployed site. The root page is
OpenMAIC's workspace; it asks for the course list; with accounts in place that request is answered
401, and a visitor with no account was left reading *"Persistence is unavailable. Saved classrooms
could not be loaded."* That reads as a broken deployment rather than as "please sign in". At Level 1
the shared access code caught such a visitor first, so the gap only appeared once the code was
retired. The guard now asks `/api/level2/me` once per navigation and sends an unauthenticated
visitor to `/platform/login`. Children are held back while the session is unknown and while the
redirect is in flight, so nothing issues a request that must 401. A **network failure is treated as
"render anyway", not as "signed out"**, so a dropped request never bounces someone who is signed in.

Both behaviours are inert when Supabase is not configured, so Level 1 is untouched.

**Merge risk: low.** One component; no upstream behaviour changes when accounts are off.

### 4. `app/page.tsx` — a visible way into the platform

Six lines: an import and a `<PlatformLink />` in the top-right pill, beside the language and theme
buttons. The component itself is ours (`components/level2/platform-link.tsx`) and renders `null`
when Supabase is not configured, so Level 1 shows nothing new.

Found when the project owner opened the deployed link: the bare address is OpenMAIC's workspace, a
chat box saying "No courses yet". Nothing on that screen mentions accounts, courses or classes, and
nothing links to `/platform`. A reviewer handed the link had no way in short of typing the path by
hand. Hiding the entrance behind a URL the reader has to know is not a documentation problem that
the guide can fix.

**Merge risk: low.** Two lines in one JSX block; the behaviour lives in our own component.

### 5. `components/classroom/ClassroomSurface.tsx` — a refusal is not a failure

A student who opened a course they are not enrolled in read
`Error: @openmaic/storage: document authorization required`, under a **Retry**
button that can never succeed, because the refusal is correct and permanent. The
error card now recognises an authorization refusal and says "You cannot open this
course", with a way back to their own courses, and leaves every other error
exactly as it was.

The branch is additive and guarded by a regex over the error text, so an
OpenMAIC deployment without accounts can never reach it.

**Merge risk: low.** One conditional inside one error card.

### 6. `.gitignore` — admit the documentation

Upstream ignores `/docs`, but the instruction names `docs/ADMIN_MANUAL.md`,
`docs/LEVEL2_DATABASE_SCHEMA.md` and others by path. A negation admits exactly those.

**Merge risk: none.**

### 7. `package.json`, `pnpm-lock.yaml` — two dependencies

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
