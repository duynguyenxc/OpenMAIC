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
- [x] Confirm Level 1 still passes: instructor creates course · student accesses classroom ·
      student interacts · student cannot edit course

## B. Audit before design — **required before any schema work**

- [x] Inspect DocumentStore, RuntimeStore, PostgreSQL persistence
- [x] Inspect course/stage ownership, learnerKey, runtime sessions
- [x] Inspect learner chat records *(quiz / PBL observed in schema only — no live data yet)*
- [x] Inspect agent sessions, ACCESS_CODE, owner identity, course read/write authorization
- [x] `docs/LEVEL2_ARCHITECTURE_AUDIT.md` — course identity · ownership · learner runtime ·
      data location · APIs needing modification

## C. Authentication and users

- [ ] Individual authentication (Supabase Auth preferred) — **blocked on database decision, audit §9**
- [ ] `user_profiles` (id, auth_user_id, email, display_name, role, external_identifier,
      institution, status, created_at, updated_at)
- [ ] Roles ADMIN / INSTRUCTOR / STUDENT; status ACTIVE / INACTIVE / PENDING
- [ ] `student_identifier` separate from email *(not the research participant id)*
- [ ] A user can never change their own role from the client; ADMIN only
- [ ] Register the host auth method; switch the anonymous fallback off

## D. Course and authorization model

- [ ] `courses` (id, openmaic_stage_id, title, owner_instructor_id, status, timestamps);
      DRAFT / PUBLISHED / ARCHIVED — referencing the OpenMAIC stage, not duplicating it
- [ ] `course_instructors` (course_id, instructor_id, permission OWNER/EDITOR/VIEWER, added_by)
- [ ] `enrollments` (course_id, student_id, status ACTIVE/INACTIVE/COMPLETED, enrolled_at, enrolled_by)
- [ ] Central authorization helpers: `requireAuthenticatedUser()`, `requireAdmin()`,
      `requireCourseInstructor()`, `requireCourseEditor()`, `requireCourseEnrollment()`
- [ ] Every sensitive route uses them — UI hiding is not security
- [ ] Student read requires: authenticated AND role STUDENT AND active enrollment AND course published
- [ ] **Course id alone is no longer sufficient authorization** *(audit §6: today it is)*
- [ ] Unauthorized writes return 403
- [—] Student cannot modify course document / slides / quizzes / PBL / prompts / agents
      *(storage already refuses non-owners — audit §6)*

## E. Learner identity binding

- [—] Server derives learner identity; request body/path not trusted *(audit §4)*
- [—] Browser cannot address another learner's partition *(403 FORBIDDEN_LEARNER — audit §4)*
- [ ] Learner identity is an **authenticated account**, not an anonymous browser cookie
- [—] Reuse OpenMAIC RuntimeStore for chat / quiz / PBL / progress — no competing tables *(audit §5)*
- [—] Every runtime record associable with course · student · activity · type · timestamp *(audit §5)*

## F. Dashboards

- [ ] **Student**: My Courses; open classroom; must not see New Course, Generate, Pro Workbench,
      Edit, Delete, other students, provider settings
- [ ] **Instructor**: course list with student count, co-instructors, last activity; Create Course;
      Manage Students; Course Results
- [ ] Instructor can open one enrolled student and see their timeline, AI interactions, quiz
      attempts, PBL state, progress — and **only** for authorized courses
- [ ] **Admin**: users (role, institution, status, activate/deactivate, change role); all courses;
      authorization management; all results

## G. Export

- [ ] Instructor exports own course data as CSV and JSON
- [ ] Only data actually available — no fabricated measures
- [ ] Never export passwords, API keys, tokens, credentials

## H. Account provisioning

- [ ] Admin-created accounts, or self-registration held at PENDING until approved
- [ ] No unrestricted public instructor registration

## I. Course duplication (prepares Level 3)

- [ ] Duplicate Course: new id; original unchanged; **learner runtime not copied**; enrollment not copied

## J. Testing — *"Do not rely only on browser testing. Test APIs directly."*

- [ ] Test accounts: admin, instructor1/2, student1/2/3
- [ ] Course A (Instructor 1 → Students 1,2) · Course B (Instructor 2 → Student 3)
- [ ] Authorization matrix for Admin, Instructor 1/2, Student 1/3
- [ ] Direct API attacks as Student 1: edit/delete Course A · edit/read Course B ·
      read Student 2 and 3 runtime · submit runtime as Student 2 — each must be 401/403
- [ ] Automated authorization tests
- [ ] Co-instructor: add Instructor 2 as EDITOR to Course A, verify, remove, verify immediate loss
- [ ] Two students in one course: runtime records provably separate across chat, quiz, PBL, progress

## K. Documentation

- [ ] `docs/ADMIN_MANUAL.md`
- [ ] `docs/INSTRUCTOR_MANUAL.md`
- [ ] `docs/STUDENT_MANUAL.md`
- [ ] `docs/LEVEL2_DATABASE_SCHEMA.md` — ER diagram, keys, links to OpenMAIC storage
- [ ] `docs/LEVEL2_SECURITY_MODEL.md`
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

1. **Database** — one database (move `DATABASE_URL` to Supabase) or two (Neon + Supabase auth)?
   Audit §9 recommends one, because `onCreate` runs inside OpenMAIC's transaction and cannot be
   atomic across two databases. **Awaiting owner decision.**
2. **Staging project** — a second Vercel project is required so the Level-1 URL keeps working.

## Known consequence to communicate

Turning authentication on makes the current public classroom link unusable without an account. The
Level-1 deployment must therefore keep running unchanged, which the instruction already requires.
