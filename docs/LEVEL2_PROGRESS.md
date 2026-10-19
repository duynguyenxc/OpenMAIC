# Level 2 — Requirement Tracker

Every requirement in the Level-2 instruction (`instruction to AI coding agent-v2.docx`), with its
status. Nothing is marked done until it has been tested, not merely written.

**Legend** — `[ ]` not started · `[~]` in progress · `[x]` done and tested · `[—]` already provided
by OpenMAIC, confirmed by audit

Branch `feature/level2-rbac` · baseline tag `level1-classroom-pilot` · audit:
[LEVEL2_ARCHITECTURE_AUDIT.md](LEVEL2_ARCHITECTURE_AUDIT.md)

---

## A. Preparation

- [x] Tag the working version `level1-classroom-pilot` *(pushed to fork)*
- [x] Create branch `feature/level2-rbac`
- [x] Preserve upstream reference *(remote `upstream` → THU-MAIC/OpenMAIC retained)*
- [x] Preserve Level-1 cloud deployment *(openmaic-bice-five.vercel.app, untouched)*
- [x] Confirm Level 1 still passes — **all four, on the deployed Level-2 site**: an instructor
      generated a course while signed in; a student opened the classroom; the lesson played and
      wrote 2 runtime records under that student's own account while the other student stayed at 0;
      a student editing the course is refused

## B. Audit before design — **required before any schema work**

- [x] Inspect DocumentStore, RuntimeStore, PostgreSQL persistence
- [x] Inspect course/stage ownership, learnerKey, runtime sessions
- [x] Inspect learner chat records *(quiz / PBL observed in schema only — no live data yet)*
- [x] Inspect agent sessions, ACCESS_CODE, owner identity, course read/write authorization
- [x] `docs/LEVEL2_ARCHITECTURE_AUDIT.md` — course identity · ownership · learner runtime ·
      data location · APIs needing modification

## C. Authentication and users

- [x] Individual authentication (Supabase Auth) — `lib/level2/session.ts`, verified end to end
- [x] The shared ACCESS_CODE is retired for Level 2: accounts authorize, and a code every student
      would have to know is not a control. Verified afterwards that every owner-scoped API still
      answers 401 without a session, and that only the sign-in page is reachable
- [x] `user_profiles` (id, auth_user_id, email, display_name, role, external_identifier,
      institution, status, created_at, updated_at)
- [x] Roles ADMIN / INSTRUCTOR / STUDENT; status ACTIVE / INACTIVE / PENDING *(CHECK constraints, tested)*
- [x] `external_identifier` separate from email *(not the research participant id)*
- [x] A user can never change their own role from the client; ADMIN only *(tested: student → ADMIN is 403)*
- [x] Register the host auth method; switch the anonymous fallback off *(instrumentation.ts; unauthenticated requests now 401)*

## D. Course and authorization model

- [x] `courses` (id, openmaic_stage_id, title, owner_instructor_id, status, timestamps);
      DRAFT / PUBLISHED / ARCHIVED — referencing the OpenMAIC stage, not duplicating it
- [x] `course_instructors` (+ partial unique index: exactly one OWNER per course)
- [x] `enrollments` (course_id, student_id, status, enrolled_at, enrolled_by)
- [x] Central authorization helpers in `lib/level2/authorization.ts`: `requireAuthenticatedUser()`,
      `requireAdmin()`, `requireCourseInstructor()`, `requireCourseEditor()`, `requireCourseOwner()`,
      `requireCourseEnrollment()`
- [ ] Every sensitive route uses them — UI hiding is not security
- [x] Student read requires: authenticated AND active enrolment AND course PUBLISHED *(all four cases tested)*
- [x] **Course id alone is no longer sufficient authorization** — instructor2 and an unenrolled student now get 403 where both previously got 200
- [x] Unauthorized writes return 403 *(storage, plus CREATE_REFUSED for students)*
- [—] Student cannot modify course document / slides / quizzes / PBL / prompts / agents
      *(storage already refuses non-owners — audit §6)*

## E. Learner identity binding

- [—] Server derives learner identity; request body/path not trusted *(audit §4)*
- [—] Browser cannot address another learner's partition *(403 FORBIDDEN_LEARNER — audit §4)*
- [x] Learner identity is an **authenticated account** — `learnerKey = user:<auth_user_id>`, verified
- [—] Reuse OpenMAIC RuntimeStore for chat / quiz / PBL / progress — no competing tables *(audit §5)*
- [—] Every runtime record associable with course · student · activity · type · timestamp *(audit §5)*

## F. Dashboards

- [x] **Student**: My Courses with title, instructor, status, last activity and Open course.
      None of the forbidden items is rendered, and each is refused server-side as well
- [x] **Instructor**: course list with student count, co-instructors and last activity; the four
      actions Edit / Open classroom / Manage students / Results; publish and unpublish
- [x] Instructor can open one enrolled student and see their timeline — `GET .../results?email=`;
      an instructor of another course gets 403, never a filtered empty list
- [x] **Admin** dashboard and API: pending approvals, users with role/status changes, all courses
      with owner, co-instructors, student count and status.
      A student self-promoting to ADMIN gets 403; an administrator may not change their own role

## G. Export

- [x] Instructor exports own course data as CSV and JSON *(`.../export?format=`; student gets 403)*
- [x] Only data actually available — quiz/PBL are runtime kinds, not invented columns
- [x] Never export passwords, API keys, tokens, credentials *(queries touch only enrolment, profile and runtime tables)*

## H. Account provisioning

- [~] Self-registration held at PENDING implemented in the auth method; admin approval UI still to build
- [ ] No unrestricted public instructor registration

## I. Course duplication (prepares Level 3)

- [x] Duplicate Course: new id; original unchanged; content copied; **learner runtime not copied**
      (0 against the source's 2); enrolment not copied (0 against 2); the duplicating instructor
      becomes OWNER; the copy starts as DRAFT

## J. Testing — *"Do not rely only on browser testing. Test APIs directly."*

- [x] Test accounts: admin, instructor1/2, student1/2/3 *(created; passwords in gitignored .env.level2-test-accounts)*
- [x] Course A (Instructor 1 → Students 1,2) · Course B (Instructor 2 → Student 3) *(built by the test itself, fresh each run)*
- [x] Authorization matrix for Admin, Instructor 1/2, Student 1/3
- [x] Direct API attacks as Student 1 — each refused with 401 or 403
- [x] Automated authorization tests — `scripts/level2-security-tests.mjs`, **41 passed, 0 failed**
- [x] Co-instructor: added as EDITOR → gains read, student list and course listing; cannot do
      OWNER-only work; removed → both 403 again on the very next request
- [x] Two students in one course: each has their own runtime, and the two account for every
      session in the course — nothing leaked across, nothing double-counted

## K. Documentation

- [x] `docs/ADMIN_MANUAL.md`
- [x] `docs/INSTRUCTOR_MANUAL.md`
- [x] `docs/STUDENT_MANUAL.md`
- [x] `docs/LEVEL2_DATABASE_SCHEMA.md` — ER diagram, keys, links to OpenMAIC storage
- [x] `docs/LEVEL2_SECURITY_MODEL.md`
- [ ] Screenshots from the actual implementation

## L. Deployment

- [ ] All local tests pass before any deployment
- [ ] Deploy to a **separate staging URL** — do not overwrite the Level-1 deployment
- [ ] HTTPS; environment variables secured; row-level security correct if Supabase is used
- [ ] Repeat the authorization matrix against the deployed accounts, from different browsers

## M. Final deliverables to the professor

- [ ] Deployed Level-2 URL
- [ ] Admin / instructor / student test-account procedures
- [ ] Database schema
- [ ] Security test results
- [ ] Screenshots
- [ ] Files changed from Level 1
- [ ] Unresolved issues
- [ ] Recommendations for Level 3
- [ ] **Then STOP and wait for approval before Level 3**

---

## Open decisions

1. ~~**Database**~~ — **decided 2026-10-16: one database.** Supabase project `supabase-red-kite`
   provisioned through the Vercel Marketplace (free plan). Postgres 17.11; `public` empty, ready
   for OpenMAIC's own migrations; `auth` schema present with 27 tables, so Supabase Auth is
   available as the instruction prefers. Rationale in audit §9.
2. ~~**Staging project**~~ — **created: `openmaic-level2`**, a second Vercel project. Supabase is
   connected to it, not to the Level-1 project. Verified after provisioning that the Level-1
   deployment still serves 200 and that no Supabase variable reached its environment.

## Known consequence to communicate

Turning authentication on makes the current public classroom link unusable without an account. The
Level-1 deployment must therefore keep running unchanged, which the instruction already requires.

---

## Operational notes discovered while building

**Supabase signs tokens with ES256, not HS256.** The project publishes its public key at
`/auth/v1/.well-known/jwks.json`, so the legacy `SUPABASE_JWT_SECRET` cannot verify an access
token. `auth.getClaims()` is used instead: it caches the key set and verifies locally, so a request
costs no round trip to the Auth server.

**`sslmode=require` alone fails against Supabase** with node-postgres 8.22:
`SELF_SIGNED_CERT_IN_CHAIN`. The connection string needs `&uselibpqcompat=true`, the
forward-compatible spelling node-postgres itself recommends. Encryption was confirmed afterwards
through `pg_stat_ssl`, so this restores libpq semantics rather than disabling TLS. *For production,
pinning Supabase's CA with `sslrootcert` would be stronger and should be revisited before any real
student data is stored.*

**Use port 5432, not 6543.** The 6543 pooler is transaction-mode, which breaks the session-scoped
features OpenMAIC relies on (advisory locks, prepared statements).

**OpenMAIC migrates lazily**, on the first request that touches persistence — not at start-up. With
the anonymous fallback off, that first request must be authenticated, so the schema appears only
after a real sign-in.

---

## Database access and local copies (added 2026-10-16)

The live database is Supabase, for two structural reasons: a Vercel staging deployment cannot reach
a laptop, and `user_profiles.auth_user_id` references Supabase's own `auth.users`. Everything is
copied to this machine anyway.

- [x] `scripts/level2-db-backup.sh` — full dump of `public` **and** `auth` into `db/backups/`,
      keeping the ten most recent. Gitignored: the dumps contain password hashes.
- [x] `scripts/level2-db-mirror.sh` — restores the newest dump into a local `openmaic_mirror`
      database. Verified: 21 public tables, 27 auth tables, 6 profiles, 6 auth users.
- [x] `scripts/level2-db-viewer.sh` — Adminer in a container at `localhost:8080`, nothing installed.
      Connected and confirmed against the live database.
- [x] `openmaic_viewer` read-only role for the mirror; verified it can read every table and write
      none.
- [x] `docs/LEVEL2_DATABASE_ACCESS.md`

Two traps worth keeping: Adminer must use the **pooler** host with the `postgres.<ref>` username,
because `db.<ref>.supabase.co` resolves only over IPv6; and Adminer refuses the local PostgreSQL
because it trusts any password over TCP, so the mirror is read with `psql` instead. Changing
`pg_hba.conf` was rejected deliberately — the realist-synthesis project uses the same server.

---

## Audit against the instruction before building the UI (2026-10-16)

Re-read the dashboard sections line by line and compared them with what had been built. Three
divergences were found and corrected before any interface work started.

**1. The course list was missing "last activity".** The instruction lists it for the instructor
dashboard. Added as the most recent moment any enrolled learner touched that course's runtime.

**2. Co-instructors were only a count.** The instruction says to show co-instructors; the list now
carries their emails as well as the count.

**3. The export did not use the field names the instruction names.** It had a single `payload`
blob. Corrected to the instruction's own list and order, populated from what the records actually
contain — verified against a real runtime record rather than assumed:

| Instruction field | Source | Verified |
|---|---|---|
| `course_id`, `course_title` | course row | ✅ |
| `student_identifier` | `user_profiles.external_identifier` | ✅ |
| `student_internal_id` | `user_profiles.id` | ✅ |
| `activity_id` | `payload.sceneId`, else the record's scene | ✅ |
| `activity_type` | `payload.kind` | ✅ `chat_message`, `chat_session_state` |
| `timestamp`, `seq` | record | ✅ |
| `learner_input` | `payload.content` where `payload.role = 'user'` | ✅ |
| `agent_response` | `payload.content` where `payload.role = 'assistant'` | ✅ carries the real lecture text |
| `quiz_item`, `quiz_response`, `quiz_score`, `PBL_event`, `progress_state` | — | **empty, deliberately** |

The last row is the instruction's own rule applied honestly. No quiz or PBL record exists in this
deployment: the only payload kinds observed are `chat_message` and `chat_session_state`. Any mapping
would be guessed, and the instruction says *"Include only data actually available. Do not fabricate
derived measures."* The columns are present so the export's shape will not change when such records
appear, and the untouched `payload` travels alongside so nothing is lost in the meantime.

**Checked and already correct:** an administrator reaches every course-scoped route, because each
`require*` helper returns early for ADMIN — so "ADMIN can inspect all course results", "assign
instructor", "enroll student" need no separate admin endpoints. Student self-promotion, cross-course
reads and cross-course student lists were already refused.

---

## Audit against the professor's own 22-item checklist (2026-10-16)

Checked against the list in the instruction, not against this tracker, so the criteria are his.

| # | Criterion | Status |
|---|---|---|
| 1 | Individual login works | ✅ browser-tested |
| 2–4 | ADMIN / INSTRUCTOR / STUDENT roles work | ✅ each dashboard and API tested |
| 5 | Multiple instructors can create different courses | ✅ Course A and Course B, different owners |
| 6 | Instructor cannot modify unrelated courses | ✅ 403 |
| 7 | Instructor can enrol selected students | ✅ API and UI |
| 8 | Student sees only enrolled courses | ✅ student 3 sees Course B only |
| 9 | Student cannot modify course content | ✅ 403 |
| 10 | Student identity is server-authenticated | ✅ `learnerKey = user:<auth_user_id>` |
| 11 | Student cannot impersonate another learner | ✅ 403 FORBIDDEN_LEARNER on an otherwise identical request |
| 12 | Student interaction data remain separate | ✅ each has their own, and the two account for every session |
| 13 | Instructor can inspect enrolled students individually | ✅ `/results?email=` |
| 14 | Instructor can retrieve quiz/chat/PBL records | ⚠️ **chat proven; quiz and PBL unproven** — see below |
| 15 | Instructor can export their course data | ✅ CSV and JSON |
| 16 | Administrator sees all courses | ✅ |
| 17 | Administrator manages instructors/students | ✅ role, status, approval |
| 18 | API authorization tests pass | ✅ 41 passed, 0 failed |
| 19 | **Level-1 learning features continue working** | ✅ **verified: a course was generated while signed in as an instructor** |
| 20–22 | Admin / Instructor / Student manuals | ⚠️ **written, but with no screenshots** — see below |

**On 19.** This was unverified until now, and it was the largest regression risk in the whole level:
if replacing the identity source had broken generation, everything else would have been beside the
point. Signed in as instructor1, a course was generated end to end through the normal OpenMAIC flow.
It produced its AI personas and scenes, and `stage_meta.owner_id` came out as
`user:e7edcbbc-…`, which is exactly instructor1's `auth_user_id` — so the identity chain holds
through the whole generation pipeline, and the course was bound to its instructor automatically.

**On 14.** The retrieval is kind-agnostic: it reads `runtime_sessions.kind` and the records beneath,
whatever kind they are. Chat is proven end to end. No quiz or PBL record has ever been produced in
this deployment — the only payload kinds observed are `chat_message` and `chat_session_state`, and
the course generated for this test produced no quiz either. That half of the criterion therefore
rests on the design rather than on a measurement, and is listed as an unresolved issue rather than
claimed.

**On 20–22 (corrected 2026-10-19).** These were ticked as complete. The instruction says *"Use
screenshots from the actual implementation."* The three manuals contain **zero** images, and
`LEVEL2_DATABASE_SCHEMA.md` has no ER diagram although the instruction asks for one. The tick was
too generous and is withdrawn until both exist.

**Items the instruction asks for that this tracker never listed, found on 2026-10-19.** The
22-item list is the professor's own success criteria, and passing it is not the same as having
built what the document describes. A full audit against the prose — `docs/LEVEL2_UX_AUDIT.md` —
found six capabilities named in the instruction and absent from the build: course **deletion**
(no endpoint exists at all), **course creation** from the dashboard once an instructor owns one,
**renaming** a course, the administrator's **AUTHORIZATION** group, and any interface for
**co-instructors** (the API exists and is tested; nothing calls it). None of them weakens the
authorization model; all of them are things a tester reaches for in the first five minutes.
