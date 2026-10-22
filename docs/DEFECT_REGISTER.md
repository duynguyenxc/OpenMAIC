# Defect register — what a real user hits

Written on 22 October 2026 by signing in as each of the three roles in turn on
`http://localhost:3000` at 1440×900 and pressing the buttons, rather than by
reading the code. Every entry below was reproduced by hand; where a fix landed
the same day, the entry says how it was verified.

The API suites pass at 227 checks and the unit tests at 23, and they passed
before this audit too. That is the point of the register: the suites prove the
server refuses what it should, and almost nothing here is the server. What is
left is the part a person meets — a button that promises the wrong thing, an
error about the previous mistake, a page drawn for somebody who may not use it.

Severity is about what it costs the person in front of it, not about how deep
the code change is.

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

---

## Open — worth fixing, in rough order

### O1 — "Archive it" sometimes deletes
**Severity: high, because it is about losing work.** The delete dialog explains
the rule correctly — *"If any of them has worked in it, the course is archived
rather than deleted"* — and then labels the button **Archive it**
unconditionally. On a course with students but no sessions, pressing it deletes
the course permanently.

The row already shows `last activity —` when nothing has happened, so the
client knows which of the two outcomes applies. The dialog should say the one
that will actually happen, and the button should read *Delete permanently* when
that is what it does.

### O2 — the inline rename throws away what you typed when the server refuses
**Severity: medium.** Rename a course to a name another of your courses already
uses: the server correctly answers *"that instructor already has a course with
this name; pick another"*, and the editor closes and reverts. A long title is
gone and has to be retyped. The editor should stay open with the text in it.

The same pattern appears on the administration page: a refused *Add institution*
clears both boxes. One fix, two places.

### O3 — the banner shows the previous error while the next request is running
**Severity: medium.** After a refused rename, pressing Save again leaves the
*old* message on screen for the five seconds the new request takes — so the
reader is told "a course title cannot be empty" about an action that has
nothing to do with an empty title. The correct message replaces it afterwards.

The banner should clear when a request starts, or read *Working…*.

### O4 — the banner shifts the controls under it
**Severity: low, but it caused a misclick during this audit.** The message sits
above the tab strip inside the course dialog and above the toolbar on the
instructor page. When it appears or clears, everything below moves by about
18 px, so a click aimed at a tab lands on nothing. Reserve the space, or put
the message somewhere that does not reflow the page.

### O5 — a student leaving a class lands in the generic chatbot
**Severity: medium.** The classroom page has **no links at all** — no "My
courses", no sign-out, no platform header. The back arrow at the top left goes
to the OpenMAIC workspace landing page ("Hi, Learner — tell me anything you
want to learn"), not back to the course list. The *Platform* button we added
is the only way home, and from a student's seat it is two hops and the wrong
word.

The classroom should return a platform learner to `/platform/student`.

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

### O15 — restoring an archived course fails with a bare 500 when its name has been reused
**Severity: medium.** Archive a course, rename another to that title (allowed —
the unique index excludes ARCHIVED), then set the archived one back to
PUBLISHED: **`500 INTERNAL — request failed`**. The instructor archived
something and cannot get it back, with no explanation. It should be a 409
saying the name is taken and to rename first.

### O16 — wording written for an administrator, shown to a teacher
**Severity: low.** The rename collision reads *"that instructor already has a
course with this name"*. The instructor is the person reading it: *"you already
have a course with this name"*. Similarly *"only STUDENT accounts can be
enrolled"* names an internal role constant.

### O17 — as an administrator, the instructor page still says "My courses"
**Severity: low.** An administrator on `/platform/instructor` sees every
course on the platform under the heading *My courses — courses you own or have
been given access to*. True for an instructor, false for them.

### O18 — the login page has no way back
**Severity: low.** `/platform/login` has no link to the workspace. Someone who
lands there by accident and has no account is stuck on it. Visiting it while
already signed in shows the form rather than the dashboard.

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
