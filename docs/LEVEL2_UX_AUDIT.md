# Level 2 — What is missing, and what is merely hard to use

**Duy Nguyen · 19 October 2026 · audited against `instruction to AI coding agent-v2.docx`**

The project owner tested the deployment and reported that it did not feel usable: *"there isn't
even a delete button."* He is right, and the delete button is not the half of it. This is the
audit, done by driving the interface as each role rather than by re-reading the requirement list.

Everything below is measured. Where a number appears it was taken from the running application,
not estimated.

## How this was tested

- Each of the three roles was signed in on the local server at commit `71ecc99e`, the same code
  that is deployed.
- The API surface was enumerated directly from `app/api/level2/**/route.ts` — every route and
  every HTTP method it exports.
- Page heights, panel positions and overflow were measured in the browser, at 1280×800 and at
  375×812.
- The instruction was re-read in full first, so that a gap is reported against what the professor
  asked for, not against taste.

**A note on the previous tracker.** `docs/LEVEL2_PROGRESS.md` ticks items 20–22, the three
manuals, as complete. The instruction says *"Use screenshots from the actual implementation."*
There are **zero** images in the three manuals. Those ticks were too generous and are corrected
there.

---

## A. Capability that is missing, and that the instruction asks for

### A1. There is no delete. Anywhere.

The instruction says ADMIN *"may create/edit/delete any course"* and INSTRUCTOR OWNER *"may
create/edit/delete own course."*

No course-delete endpoint exists. The only `DELETE` handlers in the whole Level 2 API are for
enrolments and for co-instructors:

| Route | Methods |
|---|---|
| `/courses/[stageId]` | PATCH |
| `/courses/[stageId]/enrollments` | GET POST **DELETE** |
| `/courses/[stageId]/instructors` | GET POST **DELETE** |
| `/courses/[stageId]/duplicate` | POST |
| `/courses/[stageId]/results`, `/export`, `/courses`, `/me` | GET |
| `/admin/users` | GET PATCH |

So the missing button is not an oversight in the interface; the capability was never built.

**What it costs right now.** Instructor One's dashboard currently shows
*"Demo 1 — Realist Evaluation (Instructor One) **(copy) (copy)**"*. Duplicates accumulate and
nothing can remove them. The fourteen junk courses left by the security runs are in the same
position: the guide tells the reader to ignore them because there is no other option.

**Fix.** `DELETE /api/level2/courses/[stageId]`, owner-or-admin, with a typed confirmation, and a
decision recorded about what happens to learner runtime — almost certainly archive rather than
destroy, since that data is research data.

### A2. Once you have one course, there is no way to create another

`app/platform/instructor/page.tsx:86` renders the **Open workspace** button only when
`courses?.length === 0`. An instructor with one course has no route to a second one except
knowing to type `/` in the address bar. The instruction lists **CREATE COURSE** as the first
instructor function.

**Fix.** A permanent *New course* button in the dashboard header.

### A3. A course cannot be renamed from the interface

`PATCH /courses/[stageId]` accepts a `title`. Nothing in the interface ever calls it with one —
the only caller is the duplicate flow. This is why courses sit at *"Untitled course"*, and why the
two demo courses had to be renamed with a direct database statement during handover preparation.

**Fix.** Inline rename on the course card.

### A4. The administrator has no authorization surface

The instruction's ADMIN DASHBOARD has three groups. USERS and COURSES exist. The third —
**AUTHORIZATION: assign instructor; remove instructor; enroll student; remove student** — does
not. The administrator's only per-course control is *Open*, which links to `/classroom/<id>`,
i.e. viewing the lesson.

The code says this was deliberate: *"AUTHORIZATION, which needs no separate surface because every
course route already admits an administrator"* (`app/platform/admin/page.tsx:7`). That is true of
the **API** and false of the **administrator**, who cannot reach it. The instruction asks for the
dashboard, not for the permission.

**Fix.** Reuse the roster and co-instructor panels on the admin side, scoped to any course.

### A5. Co-instructors can only be managed by hand-written API calls

`POST` and `DELETE /courses/[stageId]/instructors` both work and are covered by the automated
matrix. The dashboard only *prints* `Co-instructors: none`. The instruction asks that an
instructor *"may share a course with authorized co-instructors"*, and its acceptance test asks for
Instructor 2 to be added as EDITOR and then removed, confirming access appears and disappears.
A human being cannot perform that test in this interface.

**Fix.** Add the panel; the API behind it is already written and tested.

### A6. Documentation artefacts the instruction names explicitly

- The three manuals contain **0 screenshots**; the instruction says to use screenshots from the
  actual implementation.
- `docs/LEVEL2_DATABASE_SCHEMA.md` has **no ER diagram**; the instruction asks for one.

---

## B. Built, but hard to use

### B1. Your click's result appears three screens below where you clicked — measured

Click **Manage students** on the first course card. The panel opens at **3,193 px** from the top
of the document, while the viewport is 800 px tall and the scroll position is 0. You must scroll
roughly **2,600 px** — more than three screens — to see what your own click did. There is no
scroll-into-view, no highlight, and no message.

From the outside this is indistinguishable from a button that does nothing. It is almost certainly
the single largest reason the system "doesn't feel logical".

**Fix.** Open the panel inside the card, or scroll to it, or make it a dialog. Any of the three.

### B2. The list does not survive a real number of courses

Instructor One has 11 courses. That page is **3,193 px** tall at 1280×800 — four screens — and
**4,921 px** on a phone, which is six. There is no search, no filter, no sort, no pagination and
no way to collapse a card. A real instructor with twenty courses, or an administrator looking at
every course on the platform, cannot work here.

**Fix.** Search and a status filter; sort by last activity; collapse the button row until a card
is opened.

### B3. There is no navigation — the header has zero links

Measured: `document.querySelectorAll('header a, nav a')` returns **nothing**. The only control in
the platform header is *Sign out*. You cannot get from the platform to the OpenMAIC workspace;
the **Platform** button added on 16 October goes the other way only. There is no breadcrumb, no
way back from a classroom, and no marker of where you are.

**Fix.** Real header navigation per role, and a way back from the classroom.

### B4. `/platform` is a blank white screen while it decides who you are

Signing in lands on `/platform`, which chooses a dashboard by role. During that it renders
nothing — not a spinner, not a word. On a cold server this was about ten seconds of white.

**Fix.** A loading state. It is three lines.

### B5. Courses cannot be told apart

Six courses are named *Course A*, four *Course B*, three *Untitled course*, and one
*(copy) (copy)*. The card shows no identifier and no creation date, so two cards can be
identical in every visible respect while being different courses. The testing guide has to
apologise for this.

**Fix.** Show the stage id and the creation date; let the junk be deleted once A1 exists.

### B6. The student dashboard shows no progress

The instruction asks for *"progress if available"* and the file's own comment claims it. The
rendered card shows title, instructor, status and a button. Either show it or stop claiming it.

### B7. Refusals are written in machine language

A student who opens another instructor's course by address gets
`Error: @openmaic/storage: document authorization required`, under a **Retry** button that can
never succeed. The refusal is correct and important; its wording tells the reader nothing and its
only affordance is a lie.

**Fix.** "You are not enrolled in this course," and a link back to their own courses.

### B8. The header collides on a phone

At 375 px, *"Instructor One"* wraps to two lines and overlaps the role chip. No horizontal
overflow anywhere, which is the good half of the news.

---

## C. What is right, and should not be touched while fixing the above

- **The security core.** 41 automated checks pass against the live site. The enforcement is on the
  server, on every request, and the before/after is measured: instructor2 reading instructor1's
  course returned 200 with the full 104 KB document before, and 403 after; two requests differing
  only in `learnerKey` return 201 and 403.
- **The classroom.** Untouched and still teaching, including course generation signed in as an
  instructor.
- **Export.** CSV and JSON, real content, with the unavailable columns left honestly empty.
- **The roster.** Add by email, deactivate, reactivate — reversible, with feedback, and it works.
- **The trajectory view.** The one screen in this platform that does its job well.

---

## Suggested order

**First — the system stops looking broken.** A1 delete · A2 create · B1 panel position ·
A4 + A5 authorization panels. These are the four things a tester hits in the first five minutes.

**Second — it survives a real class.** B2 search and sort · B3 navigation · A3 rename ·
B5 distinguishable cards.

**Third — the handover is complete on the professor's own terms.** A6 screenshots and ER diagram ·
B4 loading state · B7 error wording · B6 progress · B8 mobile header.

None of this touches the authorization model, which is the part that was hard and is correct.
