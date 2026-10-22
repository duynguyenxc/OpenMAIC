# Defect register — what a real user hits

Written on 22 October 2026 by signing in as each of the three roles in turn on
`http://localhost:3000` at 1440×900 and pressing the buttons, rather than by
reading the code. Every entry below was reproduced by hand; where a fix landed
the same day, the entry says how it was verified.

The API suites passed before this audit and pass after it, now at **232
checks**. That is the point of the register: the suites prove the server
refuses what it should, and almost nothing here was the server. What was left
is the part a person meets — a button that promised the wrong thing, an error
about the previous mistake, a page drawn for somebody who may not use it.

Severity is about what it costs the person in front of it, not about how deep
the code change is.

**Eight fixed** (F1–F8), all verified; **fourteen open** (O4, O6–O14,
O16–O19), none of them about losing work. The open list is a list of findings,
not a changelog.

---

## Fixed in this pass

### F1 — a student named as principal investigator could read and export that study
**Severity: high.** The studies *list* refuses a student outright
(`studies are not visible to students`), but every per-study route authorised
the principal investigator by a row in `studies`, without looking at the
account's platform role. The administration page let an administrator type any
address into *Create study*, student addresses included.

Reproduced: created a study with `student1@example.test` as investigator, then
signed in as that student — `GET /studies/{id}/participants` → **200**,
`GET /studies/{id}/export` → **200**. The probe study was empty, so nothing
real was exposed; with a course attached, that student could have exported
their classmates' research data.

Fixed in two places, because one of them should be enough on its own:
- `app/api/level3/studies/route.ts` refuses a student investigator at creation
  (`409 STUDENT_CANNOT_LEAD_STUDY`), the way enrolment already refuses a
  non-student and the teaching team already refuses the owner.
- `lib/level3/authorization.ts` — `requireStudyAccess` now refuses a STUDENT
  before consulting any row, so a row can never grant what the role denies.

Verified: the same probe now returns **403** on both routes, and creating a
study with a researcher as investigator still returns 201. Two checks added to
`scripts/level3-research-tests.mjs`.

### F2 — the institution roll was readable by anyone signed in
**Severity: medium.** `GET /api/level3/institutions` required only an
authenticated account. A student opening `/platform/admin` saw all three
institutions with name, country, member count and course count. Users and
studies were correctly refused on the same page; institutions were not.

The header comment said "Listing: any signed-in account", so this was a choice
rather than an oversight — but the account that needs the list is the one
filling in a select when placing a course or a study, and a student has no such
select.

Fixed: `GET` refuses a STUDENT. Instructors, researchers and administrators are
unchanged. Verified by probe (200 → 403) and by two checks in the research
suite: a student is refused, a researcher still gets 200.

### F3 — every role page rendered for every role
**Severity: medium (presentational, not a leak).** Signed in as a student,
opening `/platform/instructor` drew the complete instructor console: the
student's own three courses with **Rename, Unpublish, Duplicate and Delete**
beside each, a *+ New course* button, Shared modules and the rubric panel.
`/platform/admin` drew the administration page with *All courses* and *Delete*.

Nothing leaked and nothing could be changed — all eight write and read probes
came back 403, and the Students dialog rendered empty because its reads had
been refused. That is the complaint: it rendered **"Nobody is enrolled yet"**
for a course with two students, and offered a Delete button that can only ever
fail. The page lied politely.

Fixed: `useRoleGuard` in `lib/level2/use-platform.ts` sends a signed-in account
to its own dashboard when it opens someone else's, wired into all four
dashboards. An administrator is still allowed on the instructor and researcher
pages, because they may genuinely work there.

Verified in the browser: as a student, `/platform/instructor`,
`/platform/admin` and `/platform/researcher` all land on `/platform/student`;
as an instructor, `/platform/instructor` still renders in full; as an
administrator, both `/platform/admin` and `/platform/instructor` still render.
All 227 API checks and 23 unit tests still pass.

### F4 — "Archive it" deleted permanently (was O1)
**Severity: high.** The dialog predicted the outcome from the **student
count**, which is the wrong question — enrolling somebody is not working in
something. A course with students and no sessions was described as *"archived
rather than deleted… none of their work is lost"* under a button reading
**Archive it**, and the server then deleted it for good.

Fixed in `components/level2/delete-course.tsx`: the prediction now comes from
`lastActivityAt`, which is `max(...)` over exactly the `runtime_sessions` rows
the server counts, so the two agree by construction. It can only be stale in
the safe direction — sessions are never removed, so a course predicted
"will be deleted" can at worst turn out to be archived.

Verified in the browser on the real case that would have been destroyed —
*Course-UK — Ethical decision making*, one student, no activity:

> Nobody has worked in this course, so it will be **deleted permanently**,
> along with its one enrolment. This cannot be undone. The lesson itself stays
> in your OpenMAIC workspace.

under a button reading **Delete permanently**. A course with sessions still
reads *"Students have worked in this course, so it is archived…"* with
**Archive it**.

### F5 — restoring an archived course failed with a bare 500 (was O15)
**Severity: medium, and it felt unrecoverable.** The unique index on course
titles excludes archived rows, so the name is free while a course sits in the
archive — and taking it back is a unique violation at the moment the course
returns. That surfaced as `500 INTERNAL — request failed`: the instructor had
archived something and could not get it back, with nothing on screen to say
why.

Fixed in `app/api/level2/courses/[stageId]/route.ts`: a status change away from
ARCHIVED checks the title first and answers
`409 TITLE_IN_USE — …so this one cannot come back under that name. Rename one
of them first.` Renaming and restoring in a single PATCH works, which is the
way out.

Five checks added to `scripts/level2-security-tests.mjs` covering the whole
sequence, including that the name really is free while archived.

### F6 — a refused edit threw away what you typed (was O2)
**Severity: medium.** The inline rename closed and reverted on *every* answer,
because `change()` returned nothing and the caller closed the editor in a
`.then` that ran on refusal too. A long title met a collision and was gone.
The administration page had the same shape: a refused *Add institution*,
*Create study*, *Add section* or *Record participant* cleared its boxes.

Fixed by making both helpers return whether the server accepted it, and
clearing only on success. Verified in the browser: a colliding rename now
leaves the editor open with the text still in it.

The course dialog was already correct — it clears inside the success callback —
so nothing changed there.

### F7 — the banner showed the previous error while the next request ran (was O3)
**Severity: medium.** Every answer stayed on screen for the whole round trip of
the next action, so a second attempt was read against the first attempt's
error. During the audit this produced *"a course title cannot be empty"* about
a title that was not empty.

Fixed by clearing the message where each request starts, in all seven places
that show one: the instructor page, the admin page, the course dialog, the
research admin panel, the assessment panel, the knowledge panel and the
template library.

Verified by sampling the banner after a submit: it held the old message before
the click and was empty at 50 ms, 150 ms, 400 ms, 900 ms and 1,800 ms after it,
instead of showing the previous answer for five seconds.

### F8 — a student leaving a class landed in the generic chatbot (was O5)
**Severity: medium.** The classroom page has no links of its own, and its back
arrow went to the OpenMAIC workspace — *"Hi, Learner — tell me anything you
want to learn"* — which has nothing to do with the class just left.

Fixed by extending the exit contract that already exists in
`lib/workbench/classroom-exit.ts` (`from=workspace`, `returnTo=home`) with
`from=platform`, which resolves to `/platform`. That page asks the server who
the account is and forwards to its own dashboard, so one keyword serves all
four roles and **no path is ever taken from the query string** — there is no
open redirect here. The three dashboards open courses through
`platformClassroomHref()`.

The arrow's label is `platform.backToCourses`, added to all twelve locale
files, with a test that fails if any locale is missing it.

Verified as a student: opened a course, pressed an arrow now labelled **"Back
to my courses"**, landed on `/platform/student`.

---

## Open — worth fixing, in rough order

### O4 — the banner shifts the controls under it
**Severity: low, but it caused a misclick during this audit.** The message sits
above the tab strip inside the course dialog and above the toolbar on the
instructor page. When it appears or clears, everything below moves by about
18 px, so a click aimed at a tab lands on nothing. Reserve the space, or put
the message somewhere that does not reflow the page.

### O6 — a study cannot be edited or removed once created
**Severity: medium; it is a gap in instruction 3A rather than a bug.** There is
no `app/api/level3/studies/[studyId]/route.ts` at all: no GET, no PATCH, no
DELETE. A study is created with a title and an investigator, and is then fixed
for ever as **DRAFT** with **no protocol id**. The status cannot be moved to
ACTIVE, the protocol identifier cannot be set, the investigator cannot be
corrected, and a study made by mistake stays in the list.

The fixture study shows `PROTO-2026-001` and `ACTIVE` because it was seeded in
SQL. The product cannot currently reproduce its own fixture data. Smallest
honest fix: add status and protocol id to the create form, and a PATCH route
for both.

### O7 — the administration page is four tables and no way around them
**Severity: medium (design).** `/platform/admin` is a single column 3,400 px
tall: Users (13), All courses (26), Institutions (3), Studies (1). The Users
table has a search box; **the courses table, which is twice as long, has
neither search nor a status filter**, so 18 archived courses sit mixed in with
the live ones. The instructor page has both, and it lists a third as many rows.

What it needs, in order: a status filter and a search box on the courses table;
a count row at the top (how many accounts, how many live courses, how many
pending); and either tabs or an anchor nav so the four sections are reachable
without scrolling four screens.

### O8 — the student dashboard shows operational metadata instead of work
**Severity: medium (design).** Each course card carries *Instructor*, *Last
activity* and *Course id*. A student has no use for the course id, and "last
activity" is an administrator's column. Nothing on the page says what has been
assigned, what has been submitted, or whether any feedback is waiting — even
though Level 3 computes scores and feedback and the student is the one they are
for.

### O9 — a co-instructor's permission cannot be changed from the row
**Severity: low.** The teaching team list shows `EDITOR` / `VIEWER` as a plain
badge with only *Remove* beside it. Changing a colleague from editor to viewer
*does* work — re-add the same address with the other permission selected, and
the row updates in place without duplicating — but nothing says so. Either make
the badge a select, or say so in the line of help text already there.

### O10 — the teaching team rows reorder after an edit
**Severity: low.** After changing a permission the owner row jumped from second
to first. Rows should keep a stable order (owner first, then by name).

### O11 — the Results tab prints an empty interaction count
**Severity: low.** A student with no work reads `0 sessions · interactions ·
last —`. The number before "interactions" is missing entirely rather than
showing `0`.

### O12 — the two student counts disagree with each other
**Severity: low.** Removing a student is correctly a soft removal — *"can no
longer open this course. Their work is kept"*, badge `INACTIVE`, button becomes
*Restore*. But the dialog tab then still reads "Students (1)" when nobody can
open the course, because it counts the rows it lists and it lists inactive ones.

The course row in the list counts only the active ones. So the same course can
read `2 students` in the list and `Students (3)` in the dialog — confirmed on
*Demo 1 — Realist Evaluation*, which carries two active enrolments and one
inactive from 16 October. Pick one meaning; if the tab keeps the total, write
it as `3 (1 inactive)`.

### O13 — duplicating a long-titled course fails
**Severity: low.** `POST /duplicate` appends `" (copy)"` without checking the
200-character cap, so a 196-character title gives
`400 INVALID_TITLE — a course title cannot be longer than 200 characters`. The
only way out is to shorten the original first. Truncate the base so the suffix
fits.

### O14 — deleting a course that does not exist says "forbidden"
**Severity: low.** `DELETE /api/level2/courses/DOES-NOT-EXIST` answers
`403 FORBIDDEN — course owner permission required` rather than 404. Harmless,
but it is the same dishonesty the rest of the platform was cleaned of.

### O16 — wording written for an administrator, shown to a teacher
**Severity: low. Half fixed.** The rename collision read *"that instructor
already has a course with this name"*. It is now decided by who is asking:
*"you already have…"* for the owner, *"its owner already has…"* for an
administrator editing somebody else's course. Still outstanding: *"only STUDENT
accounts can be enrolled"* names an internal role constant.

### O17 — as an administrator, the instructor page still says "My courses"
**Severity: low.** An administrator on `/platform/instructor` sees every
course on the platform under the heading *My courses — courses you own or have
been given access to*. True for an instructor, false for them.

### O18 — the login page has no way back
**Severity: low.** `/platform/login` has no link to the workspace. Someone who
lands there by accident and has no account is stuck on it. Visiting it while
already signed in shows the form rather than the dashboard.

---

### O19 — the classroom tries to save the lesson as a student, and is refused
**Severity: low; noticed while verifying F8.** Opening a course as a student
logs `[StageStorage] Failed to save stage: document authorization required` and
`[StageStore] Failed to save to storage` on every open. The refusal is correct
— a student must not rewrite the lesson — but the attempt should not be made,
and it should not surface as an error. Nothing the student does is lost by it;
their runtime records are written through a different path.

---

## Checked and correct

Recorded so that nobody re-tests them: enrolling an address with no account
(*"no account with that email"*); enrolling an instructor (*"only STUDENT
accounts can be enrolled"*); enrolling the same student twice, in different
case (*"was already on this course"*, no duplicate row); adding the course
owner as a co-instructor (*"that account owns this course; transfer ownership
instead"*); renaming a course to its own name (accepted, no false collision);
renaming to another course's name differing only in case (refused); saving an
empty title (Save stays disabled); duplicate institution short name (refused);
a student's trajectory with no work (*"This student has not worked in the
course yet"*); the wrong password (*"Email or password is incorrect"* — does not
reveal whether the account exists, and keeps the typed address); sign-out; and
the eight instructor actions probed as a student, all 403.
