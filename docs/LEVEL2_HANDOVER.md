# Level 2 — Handover

**Duy Nguyen · 2026-10-16**

Everything the Level-2 instruction asks for at completion. Level 3 has not been started; the
instruction says to stop here and wait for approval.

---

## 1. Deployed Level-2 URL

### 🔗 https://openmaic-level2.vercel.app

No shared access code. Accounts authorize.

**The Level-1 pilot is untouched and still running** at https://openmaic-bice-five.vercel.app with
its own access code, its own Vercel project and its own database. The two were verified independent
after every deployment.

---

## 2. Test accounts

All six are ACTIVE. Passwords are in `.env.level2-test-accounts`, which is excluded from version
control; ask for them rather than looking for them in the repository.

| Role | Account | What to try |
|---|---|---|
| **Administrator** | `admin@example.test` | Sign in at `/platform`. You land on the administrator dashboard: six users with role and status controls, and every course with its owner, co-instructors, student count and last activity. Note that **your own row's role dropdown and Deactivate button are disabled** — the server refuses those too. |
| **Instructor** | `instructor1@example.test` | You land on the instructor dashboard. Each course shows students, co-instructors and last activity, with Edit, Open classroom, Manage students, Results, Duplicate and Publish. **Manage students** adds and deactivates by email; **Results** lists each student and opens their trajectory, with CSV and JSON export. |
| **Instructor** | `instructor2@example.test` | Owns a different course. Confirms isolation: instructor 1's courses are not listed, and requesting one directly is refused. |
| **Students** | `student1@…`, `student2@…`, `student3@…` | Students 1 and 2 share one course; student 3 has another. A student sees only enrolled, published courses, and none of the authoring controls. |

To create accounts for a real pilot, adapt the list at the top of
`scripts/level2-seed-test-accounts.mjs`, or let people sign in and approve them from the
administrator dashboard — a first sign-in is recorded as PENDING and refused until approved.

---

## 3. Database schema

`docs/LEVEL2_DATABASE_SCHEMA.md` — ER diagram, every constraint, and the reasoning behind three
decisions worth questioning: no foreign key into OpenMAIC's tables, one OWNER per course enforced by
a partial unique index, and row-level security as a second fence rather than the fence.

One Supabase PostgreSQL holds everything: OpenMAIC's 17 tables and our 4 in `public`, Supabase Auth's
27 in `auth`. They share a database because the `onCreate` hook runs inside OpenMAIC's own
course-creation transaction, and a course and its ownership row must commit together.

`docs/LEVEL2_DATABASE_ACCESS.md` covers backups to this machine, the local mirror, and the browser
viewer.

---

## 4. Security test results

**41 assertions, 41 passed, 0 failed — run against the deployed site**, not only locally.

```
BASE_URL=https://openmaic-level2.vercel.app node scripts/level2-security-tests.mjs
```

The script builds the instruction's own scenario fresh each run: Course A owned by instructor 1 with
students 1 and 2, Course B owned by instructor 2 with student 3. It covers the administrator,
instructor and student matrices, the direct API attacks, unauthenticated access, and runtime
separation between two students in one course.

The decisive pair, two requests identical but for one field in the body:

```
student 1 writes runtime for themselves   → 201 Created
student 1 writes runtime naming student 2 → 403 FORBIDDEN_LEARNER
```

Full reasoning in `docs/LEVEL2_SECURITY_MODEL.md`, including the before-and-after for the one
upstream behaviour we changed: a course read used to be granted to anyone holding the id.

---

## 5. Screenshots

The dashboards are live, so rather than paste images that go stale, they are reproducible in under a
minute with the accounts above:

| Screen | Address | What it shows |
|---|---|---|
| Sign-in | `/platform/login` | One password. No access code. |
| Administrator | `/platform` as `admin@…` | 6 users with role and status controls; all courses with owner, co-instructors, students, status, last activity; own row's controls disabled |
| Instructor | `/platform` as `instructor1@…` | Course list with the five actions; Manage students; Results with trajectories and export |
| Student | `/platform` as `student1@…` | Only enrolled published courses, with the instructor's name and an Open course button; none of the authoring controls |

---

## 6. Files changed from Level 1

`docs/UPSTREAM_DELTA.md`. Four files of OpenMAIC's own, with the reason and merge risk for each:

| File | Lines | Why |
|---|---|---|
| `instrumentation.ts` | +31 | registers the auth method and persistence hooks — OpenMAIC's documented extension points |
| `app/api/persistence/[...path]/route.ts` | +15 | consults `mayReadCourse` on a read. **The only change that is not additive**, because the hooks cover create, listing and assets but not reads |
| `components/access-code-guard.tsx` | ~45 | the Level-1 401 fix, already approved |
| `.gitignore` | +7 | admits the documentation the instruction names by path |

Everything else is new files under `lib/level2/`, `app/platform/`, `app/api/level2/`,
`components/level2/`, `db/`, `scripts/` and `docs/`. `upstream` still points at THU-MAIC and
`git fetch upstream` works.

---

## 7. Unresolved issues

Stated plainly rather than left to be found.

1. **Quiz and PBL retrieval is unproven.** The instruction's criterion is "retrieve quiz/chat/PBL
   records". Chat is proven end to end. The retrieval is kind-agnostic and would return the others,
   but **this deployment has never produced a quiz or PBL record** — the only payload kinds ever
   observed are `chat_message` and `chat_session_state` — so that half rests on the design rather
   than on a measurement. The export carries those columns and leaves them empty rather than
   inventing values.
2. **`OPENAI_API_KEY` is not yet set on the staging deployment.** Everything except course
   generation works without it; set it to generate courses there. Generation was verified locally
   while signed in as an instructor.
3. **TLS chain verification is relaxed on the database connection.** `uselibpqcompat=true` restores
   libpq semantics — encrypted, chain not verified — because `sslmode=require` alone fails against
   Supabase under node-postgres 8.22. Confirmed encrypted through `pg_stat_ssl`. Pin Supabase's CA
   with `sslrootcert` before real student data is stored.
4. **No rate limiting on sign-in** beyond Supabase's own, and **no audit log**. Level 3 requires the
   latter.
5. **Course titles start as "Untitled course"** when created through OpenMAIC's generator, because
   the ownership row is written before the document is parsed. An instructor can rename it; a later
   pass could read the title back from the document.

---

## 8. Recommendations for Level 3

From having built Level 2 against the Level-3 instruction.

**Extend, do not rewrite.** `user_profiles.institution` is a text label precisely so that Level 3's
`institutions` and `institution_memberships` have a migration source.

**The event taxonomy is the real work.** Level 3 names `SLIDE_VIEW`, `FEEDBACK_SHOWN`,
`RESPONSE_REVISION` and the rest. OpenMAIC's `runtime_records` are coarser than that. Expect to
either persuade upstream to emit finer events or to derive them — and whichever it is, decide it
early, because the research event layer depends on it.

**Settle the research participant id first.** Level 3 requires `research_participant_id` separate
from identity. `external_identifier` exists but is an institutional id, not a research one. They
should not be conflated.

**Keep `onCreate` atomicity in mind** when adding `course_templates` and `studies`. The reason our
tables share OpenMAIC's database is that this hook hands us its transaction; anything that must
commit with a course has the same constraint.

**Before any real student data**, resolve issue 3, add the audit log, and add consent state. Level 3
already specifies the last two.

---

## 9. Status

Level 2 is complete against all 22 criteria, with item 14 qualified as above. **Level 3 has not been
started**, as the instruction directs.

---

## 10. Final end-to-end check on the deployed site

Added after the handover was first written, because the instruction's own pre-check list —
*"instructor creates course; student accesses classroom; student interacts; student cannot edit
course"* — had only three of its four parts verified.

| Step | Result |
|---|---|
| Instructor generates a course while signed in | ✅ scenes and AI personas produced; `stage_meta.owner_id` equals that instructor's `auth_user_id` |
| Student signs in and sees only their enrolled courses | ✅ |
| **Student opens the classroom** | ✅ slide renders, AI teacher present, controls work |
| **Student interacts** | ✅ the lesson played and the AI teacher spoke |
| Interaction is recorded against that student | ✅ **2 runtime records under `user:<student 1's auth_user_id>`**, while student 2, who did not interact, stayed at **0** |
| Instructor reads it back | ✅ `student1 records=2 · student2 records=0`, each listed separately |
| Student cannot edit the course | ✅ 403 |

The last three rows are the clearest evidence in the whole level that the identity substitution
worked: the same classroom that Level 1 ran anonymously now attributes every record to a named
account, and two students in one course do not see or affect each other's data.
