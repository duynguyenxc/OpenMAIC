# Level 2 — Architecture Audit of the Existing OpenMAIC Implementation

**Duy Nguyen · 2026-10-16 · branch `feature/level2-rbac` · baseline tag `level1-classroom-pilot`**

Required by the Level-2 instruction: *"Before designing new database structures, inspect and
document the existing implementations."* Nothing in this document is designed or proposed; it
records what the current code does. Findings marked **[verified]** were produced by running the
request against the local deployment, not by reading code alone.

Audited at OpenMAIC **v1.1.1**, commit `8f7d51e5` plus one local commit (`35e96692`, access-gate
race fix from Level 1).

---

## 0. Summary for the impatient reader

Three of the four learner-security properties Level 2 asks for **already exist and are enforced by
the storage layer**. The one that does not is course read authorization.

| Level-2 requirement | Current state | Work required |
|---|---|---|
| Student cannot modify course content | **Already enforced** — `403 FORBIDDEN_DOCUMENTS` **[verified]** | None; inherit it |
| Student cannot read another student's runtime | **Already enforced** — `403 FORBIDDEN_LEARNER` **[verified]** | None; inherit it |
| Learner identity is server-derived, not client-supplied | **Already server-derived** — the route ignores the path and passes the resolved owner | Replace the *source* of identity |
| Student sees only enrolled courses | **Not enforced** — any caller holding a course id reads the full document **[verified]** | **This is the real work** |

The consequence shapes the whole of Level 2: we do not need to build learner isolation. We need to
**replace an anonymous per-browser identity with an authenticated account**, and **add an
enrollment check to course reads**. The existing enforcement then becomes real student isolation on
its own.

---

## 1. How a course is identified

A course is a **stage**, addressed by an opaque `stage_id` (observed: `_VZZSci6Om`, `zSROibTLEW`).
The same id is the unit of content, of ownership, of runtime partitioning and of the classroom URL
(`/classroom/<stage_id>`).

Content is split across four tables, all keyed by `stage_id`:

| Table | Holds |
|---|---|
| `document_stages` | course record: `id, name, description, interactive_mode, task_engine_mode, folder_id, data` |
| `document_scenes` | one row per scene: `stage_id, id, scene_order, data` |
| `document_outlines` | the generated outline: `stage_id, data` |
| `document_stage_revision`, `document_scene_revision` | optimistic-concurrency revisions |

---

## 2. How course ownership currently works

Ownership is a single row in **`stage_meta`**:

```
stage_meta [stage_id, owner_id, is_public, deleted_at, published_at, generation_complete]
```

Observed: `_VZZSci6Om | anon:59b19a0b-… | is_public = f`.

`owner_id` is the **owner principal id**, resolved per request by `lib/server/identity/`. Today it
is an anonymous per-browser id of the form `anon:<uuid>`, carried in an `HttpOnly` `anonymous_id`
cookie that lasts 400 days.

**There is exactly one owner per course.** There is no co-instructor concept, no enrollment, and no
role beyond the two the core defines (`course:publish`, `admin` — and no built-in method grants
`admin`).

---

## 3. Owner identity — the extension seam that matters most

`lib/server/identity/` resolves the owner once per request; the README states that nothing else
reads identity cookies or headers. Resolution asks an ordered list of **owner auth methods**, each
answering `authenticated` / `not-applicable` / `invalid`. When all answer `not-applicable`, the
anonymous cookie is the fallback — **and the fallback can be switched off**
(`anonymousFallback: false`).

A host registers its own methods once, from `instrumentation.ts` `register()`:

```ts
const { configureOwnerAuthentication } = await import('@/lib/server/identity');
configureOwnerAuthentication({ methods: [ /* host session method */ ] });
```

An authenticated method returns an `OwnerPrincipal`:

```ts
{ ownerId: `user:${session.userId}`, kind: 'user',
  roles: new Set(['course:publish']), assurance: 'verified' }
```

Core authorization reads **`kind` and `roles`, never the shape of the id** (`types.ts:43-49`), so a
host may mint any id scheme it likes.

**This is the single most important finding of the audit.** Level 2's central requirement —
*"The server must derive learner identity from session.user.id"* — is satisfied by registering one
auth method. No core route is forked.

Three further host hooks exist (`configurePersistenceHooks`), all registered the same way:

| Hook | What it governs | Level-2 use |
|---|---|---|
| `authorizeCreate(tx, actor)` | Course creation; a refusal is `403 CREATE_REFUSED` | Refuse course creation by a STUDENT |
| `onCreate(tx, actor, stageId)` | Runs in the create transaction | Write our `courses` row, making the instructor the OWNER |
| `library.list({principal, …})` | What `GET /api/stages` returns | Instructor sees authorized courses; student sees enrolments |

---

## 4. How learner runtime is identified

**The browser cannot choose its learner key.** `app/api/persistence/[...path]/route.ts:272-276`
hands the storage package an `authenticate` callback that ignores the request path entirely:

```ts
authenticate: async (request) => {
  if (request.url?.startsWith('/assets')) return assetPrincipal;
  return { learnerKey: ownerId };
}
```

`GET /api/persistence/learner-key` returns the same value, so the browser can address *its own*
partition without being trusted to name it.

**[verified] Impersonation is refused.** Holding a valid session, requesting another learner's
partition:

```
GET /api/persistence/runtime/stages/_VZZSci6Om/learners/anon%3Afake-other-student/sessions
→ 403 {"code":"FORBIDDEN_LEARNER",
       "message":"authenticated learner may not access the requested learner partition"}
```

The enforcement is in `@openmaic/storage`, below the application, so it cannot be bypassed by an
application route that forgets a check. **Level 2 inherits this for free**: once `ownerId` is an
authenticated account rather than a browser cookie, this *is* per-student isolation.

---

## 5. Where chat / quiz / PBL data are stored

Two tables, not one per activity type:

```
runtime_sessions [id, stage_id, learner_key, kind, status, created_at, updated_at, data]
runtime_records  [id, session_id, seq, scene_id, created_at, data]
```

- A **session** is one `(stage_id, learner_key, kind)` partition. `kind` discriminates the activity
  — the only value observed in this deployment so far is `chat`, because the pilot course was never
  taken as a quiz or PBL activity. Record ids are namespaced accordingly, e.g.
  `chat:_VZZSci6Om:anon%3Acfa3bf70-…`.
- A **record** is one ordered event inside a session (`seq`, `scene_id`, `data`).

Every learner-produced datum therefore already carries `stage_id`, `learner_key`, a kind, a scene
and an ordered sequence. The Level-2 instruction's requirement that every runtime record be
associable with course / student / activity / type / timestamp is **already satisfied by the
existing schema**; nothing needs duplicating, which is what the instruction asks us to avoid.

*Open item for Level 3:* the instruction's richer event taxonomy (`SLIDE_VIEW`, `FEEDBACK_SHOWN`, …)
is finer-grained than `runtime_records`. That is a Level-3 concern and is not addressed here.

---

## 6. Course read / write authorization today

**Write — already correct. [verified]**

```
PUT /api/persistence/documents/_VZZSci6Om   (as a non-owner)
→ 403 {"code":"FORBIDDEN_DOCUMENTS","message":"document authorization required"}
```

**Read — capability-by-id, and this is the gap. [verified]**

```
GET /api/persistence/documents/_VZZSci6Om   (as a non-owner, no enrollment)
→ 200, 104,572 bytes — the full course document
```

The README states the design intent plainly: *"Course reads are capability-by-id, so listing an id
hands it out."* Knowing the id is the authorization.

This is exactly what the Level-2 instruction forbids: *"Do NOT use knowledge of a course ID alone as
sufficient authorization once Level 2 is implemented."*

**It is also why the current classroom link works for the professor without an account** — and why
turning on accounts will break that link unless the Level-1 deployment is kept running separately,
as the instruction already requires.

---

## 7. ACCESS_CODE — what it is and what it is not

`middleware.ts:47-70`. When `ACCESS_CODE` is set, a request must carry a valid HMAC-signed
`openmaic_access` cookie, minted by `POST /api/access-code/verify`. `/api/health` and
`/api/access-code/*` are exempt.

It is a **site gate, not an identity**. Everyone who enters the code is admitted, and each is still
a separate anonymous owner. It answers "may this browser reach the deployment", never "who is
this". The instruction's note that a course id must stop being sufficient authorization applies
equally here: the access code is a shared secret, not an account.

The gate is also **fail-open**: unset means every route including the API is reachable, with no
second enforcement point. Level 2 does not rely on it for authorization, but it should remain set
on any deployment reachable from the internet.

---

## 8. Which APIs require modification

| API | Change needed | Mechanism |
|---|---|---|
| Identity resolution (all routes) | Anonymous cookie → authenticated account; anonymous fallback off | `configureOwnerAuthentication` — **no route edited** |
| `GET /api/persistence/documents/{id}` | **Add enrollment / instructor authorization** | The one place a core decision must change |
| `GET /api/stages` | List by authorization, not by ownership alone | `library.list` hook — **no route edited** |
| Course create (`POST /api/stages`, `/api/persistence`) | Refuse creation by STUDENT; record the owning instructor | `authorizeCreate` + `onCreate` hooks — **no route edited** |
| `PUT/DELETE` document routes | None — ownership already refuses non-owners | — |
| Runtime routes | None — learner partition already enforced | — |
| New app routes (dashboards, enrollment, export) | To be written | New routes, not modifications |

**Expected upstream delta for Level 2: one file** (course read authorization), plus registration in
`instrumentation.ts`. Everything else is additive. This satisfies both *"Do not rebuild the OpenMAIC
learning engine"* and the requirement to keep upstream updatable.

---

## 9. Database coexistence question — evidence for the decision

The instruction says Supabase Auth + PostgreSQL is the preferred prototype, but asks us to *"first
inspect whether the existing OpenMAIC PostgreSQL layer can share or cleanly coexist with Supabase
PostgreSQL. Do not replace OpenMAIC persistence unnecessarily."*

What the audit establishes:

- OpenMAIC owns **17 tables** in the `public` schema and reaches them through a single pooled
  connection from `DATABASE_URL`. It performs its own migrations at startup.
- Our Level-2 tables (`user_profiles`, `courses`, `course_instructors`, `enrollments`) are
  **disjoint** from those 17 and would reference `stage_meta.stage_id` and the authenticated user id.
- The `onCreate` hook runs **inside OpenMAIC's own create transaction** and hands us a `tx`. Writing
  our `courses` row transactionally with the course therefore requires our tables to live in **the
  same database**. Across two databases that write cannot be atomic, and a crash between them leaves
  a course with no owner row.

**Recommendation: one database.** Point `DATABASE_URL` at the Supabase PostgreSQL instance and let
OpenMAIC migrate into it as it does today; add our tables beside it. This keeps `onCreate`
atomic, allows direct joins for the instructor dashboard and the data export, and does not replace
OpenMAIC persistence — it relocates the database OpenMAIC already uses.

*Decision required from the project owner before implementation begins.*

---

## 10. What this audit did not cover

Stated so that later work does not assume more than was checked:

- Quiz and PBL runtime were **not observed with live data** — the pilot course was only used for
  chat. The schema path is the same (`runtime_sessions.kind`), but the exact payload shapes are
  unverified.
- Agent sessions and the Pro workbench were not exercised.
- Asset storage (`asset_entries`, `asset_blobs`, `owner_material`) was read from the schema only;
  per-owner asset authorization was not tested.
- No load or concurrency behaviour was measured.
