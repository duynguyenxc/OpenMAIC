# Level 2 — Adversarial test report, and the upgrade plan that follows from it

**Duy Nguyen · 21 October 2026**

The brief was to test the system the way an experienced tester would — not to confirm that it
works, but to try to break it — and then to plan the improvements that follow. This is that
report. Everything below was run; nothing is inferred from reading code alone.

**Scope.** The public surface was tested against the deployment at
`https://openmaic-level2.vercel.app`. The signed-in flows were tested on the local server at the
same commit, because entering a password into a public website is not something this agent is
permitted to do. Where a finding is about the deployment it says so.

**Damage done during testing, and repaired.** Two probes changed real data: one demoted the owner
of the demo course (finding **S1-1**) and one created two junk courses (**S1-2**). Both were
restored or removed immediately, and verified. Nothing else was touched.

---

## Part 1 — What survived the attack

Worth stating first, because the rest is a list of faults and that gives a false impression.

**Every unauthenticated request to the deployment is refused.** Six endpoints, all `401`:
`/api/level2/me`, `/courses`, `/admin/users`, `/api/stages`, `/courses/<id>/results`,
`/courses/<id>/export`.

**Input validation on the server is real.** A course id of `../../etc/passwd` → `403`. A
non-existent course → `403`, not a 500 and not a leak of whether it exists. `format=xml` → `400`.
`status=BANANA` → `400 INVALID_STATUS`. A student offered as a co-instructor → `400
NOT_AN_INSTRUCTOR`. An instructor offered as a student → `400 NOT_A_STUDENT`.

**The sign-in page does not enumerate accounts.** A wrong password gives *"Email or password is
incorrect"* — the same message either way — and keeps what you typed.

**Transport and framing are configured.** HSTS with `max-age=63072000; includeSubDomains;
preload`, `X-Frame-Options: SAMEORIGIN`, `Content-Security-Policy: frame-ancestors 'self'`.

**The anonymous page shell leaks nothing.** `/platform/admin` fetched with no session contains no
account, no identifier, and no `NEXT_PUBLIC_` value.

**Accessibility basics are clean.** One `h1`, a `main` landmark, every one of the 57 buttons has
an accessible name, and no input lacks a label.

**An empty course still exports correctly** — a valid CSV with its header row rather than an error.

---

## Part 2 — Findings

### Severity 1 — loses work, or locks a person out

#### S1-1. An instructor can lock themselves out of their own course, permanently

**How.** As the owner of a course, call:

```
POST /api/level2/courses/<id>/instructors
{ "email": "<your own email>", "permission": "EDITOR" }
```

It returns **200**. The upsert overwrites the existing row rather than refusing, so the owner's
`permission` changes from `OWNER` to `EDITOR`. Verified directly in the database: afterwards
`course_instructors` for that course held **one row, EDITOR, and no OWNER at all**.

**What it costs.** Every owner-gated operation then fails. Measured immediately afterwards, as
the same user: adding a co-instructor → `403 course owner permission required`; removing one →
`403`. Publishing, renaming, enrolling and exporting go the same way, because they share
`requireCourseOwner`.

**Why it cannot be undone.** Only an owner may repair the owner row, and there is no owner any
more. An administrator could — except the administrator has no interface for course authorization
(finding **S4-4**). In the shipped product this is **unrecoverable without SQL**.

**Why the 41 tests missed it.** They are written as *attacker vs. victim*: can instructor2 reach
instructor1's course. Nobody asked what happens when a user damages **their own** record. The
identical hazard *was* foreseen for administrators — `user_profiles` refuses self-demotion,
precisely so the last admin cannot lock everyone out — and the same reasoning was never applied
one table over.

**Fix.** Refuse the write when the target is the course's current owner; return `409
OWNER_CANNOT_BE_DEMOTED`. Add transfer-of-ownership as a separate, deliberate action. Add a test
for self-damage for every role.

#### S1-2. Double-clicking Duplicate creates two courses

Two simultaneous `POST /duplicate` calls both returned **201**, producing two separate courses
with the same title. The button is not disabled while in flight and the request carries no
idempotency key.

On its own this is a nuisance. With **S4-1** — there is no delete — every slip is permanent. This
is how the dashboard came to hold *"Demo 1 … (copy) (copy)"* and fourteen junk courses.

**Fix.** Disable the control while the request is open, and reject a repeat of the same
(course, title) within a few seconds.

### Severity 2 — behaviour that misleads the person using it

#### S2-1. "No activity" and "not in this course" look identical

`GET /results?email=student3@example.test` — a student enrolled in a *different* course — returns
**200** with `{"events": []}`. So does a completely invented address,
`hacker@example.test`. No data leaks, and that is the important half. But an instructor cannot
tell a student who has done nothing from a student who was never enrolled, or from a typo in the
email box. **Fix:** `404 NOT_ENROLLED` for an address that is not on this course's roster.

#### S2-2. A course title accepts 5,000 characters

`PATCH` with 5,000 characters returned **200** and stored it. No maximum, client or server. It
destroys the dashboard layout and every export row. **Fix:** cap at ~200 characters, enforced on
the server and shown as a counter in the field.

#### S2-3. A malformed email is reported as a missing account

`"khong-phai-email"` → `404 NO_SUCH_USER`. The instructor is told the account does not exist when
the real problem is that what they typed is not an email address. **Fix:** validate the shape
first and say so.

#### S2-4. Re-enrolling an active student says "Enrolled", as though it were new

Returns `200 {"enrolled": …, "status": "ACTIVE"}` with the same message as a first enrolment. The
idempotence is right — it is how a deactivated student is reactivated — but the wording should
distinguish *enrolled*, *re-activated* and *already on this course*.

### Severity 3 — usability, all measured

| | Finding | Measurement |
|---|---|---|
| **S3-1** | The result of a click appears three screens away | *Manage students* on the first card opens its panel at **3,193 px** with the viewport at 800 px and scroll at 0. No scroll, no highlight, no message. Indistinguishable from a dead button. |
| **S3-2** | The page does not survive a real number of courses | **57 buttons** on one screen; **3,193 px** tall for 11 courses (4 screens), **4,921 px** on a phone (6 screens). No search, filter, sort, pagination or collapse. |
| **S3-3** | There is no navigation | `document.querySelectorAll('header a, nav a')` → **0**. No `<nav>` element anywhere. The only header control is *Sign out*. |
| **S3-4** | `/platform` is blank while it decides your role | About **10 s** on a cold server: no spinner, no text, white. |
| **S3-5** | Courses cannot be told apart | Six named *Course A*, four *Course B*, three *Untitled course*. The card shows no id and no creation date. |
| **S3-6** | Refusals are machine language | `Error: @openmaic/storage: document authorization required`, under a **Retry** button that can never succeed. |
| **S3-7** | Every page is titled "OpenMAIC" | Five open tabs are indistinguishable. |
| **S3-8** | Status messages are not announced | `[role=alert]` count: **0**. A screen-reader user gets no confirmation that a student was enrolled. |
| **S3-9** | The header collides on a phone | At 375 px *"Instructor One"* wraps across the role chip. No horizontal overflow, which is the good half. |
| **S3-10** | A forgotten password is a dead end | Accounts are administrator-created, so this is correct by design — but the page never says *"ask your administrator"*. |

### Severity 4 — capability the instruction asks for and the build lacks

Carried over from `LEVEL2_UX_AUDIT.md`, unchanged and still true.

**S4-1** no course deletion anywhere — no endpoint exists · **S4-2** no way to create a second
course from the dashboard · **S4-3** no rename in the interface · **S4-4** the administrator has
no AUTHORIZATION surface · **S4-5** co-instructors can only be managed by hand-written API calls ·
**S4-6** no screenshots in the three manuals and no ER diagram.

### Severity 5 — hardening

Three response headers are absent from the deployment: `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, `Permissions-Policy`. Standard, cheap, and nothing observed depends on their
absence.

---

## Part 3 — The plan

Ordered by what a person hits first, not by what is interesting to build.

### Phase 1 — Stop it losing work *(do first, it contains a data-loss bug)*

1. **S1-1** refuse owner self-demotion; add explicit ownership transfer; add self-damage tests for
   all three roles.
2. **S1-2** disable controls while a request is in flight; reject near-duplicate submissions.
3. **S4-1** `DELETE /courses/<id>`, owner-or-admin, with the archive rule below.
4. **S4-2** a permanent *New course* button.

### Phase 2 — Make the screen answer the click

5. **S3-1** move *Manage students* / *Results* into a dialog over the page, with three tabs —
   Students · Teaching team · Results — so **S4-5** is solved in the same surface.
6. **S4-4** the same dialog, reachable by an administrator from any course.
7. **S3-4** a loading state; **S3-8** `role="alert"` on every status message.

### Phase 3 — Make it survive a real class

8. **S3-2** compact rows, search, status filter, sort by last activity.
9. **S4-3** inline rename, with **S2-2** the length cap.
10. **S3-5** show the course id and creation date on the row.
11. **S3-3** real navigation per role, and a way back from a classroom.

### Phase 4 — Say true things to the person reading

12. **S2-1**, **S2-3**, **S2-4**, **S3-6**, **S3-10**: every message reports what actually
    happened and what to do next.
13. **S3-7** per-page titles; **S3-9** the mobile header.

### Phase 5 — Finish the handover on the professor's own terms

14. **S4-6** screenshots through the three manuals, and the ER diagram.
15. **S5** the three missing headers.

### The deletion rule this depends on — needs the owner's decision

| Case | Proposed behaviour |
|---|---|
| Course with **no learner records** | Delete outright, one confirmation |
| Course **with** learner records | `ARCHIVED` only: gone from lists, students lose access, **data kept**, restorable |
| An administrator insisting on a hard delete | Allowed, but must type the course title to confirm |

Learner interaction data is research data, and `instruction v3` is about a research community
platform. One misplaced click should not be able to destroy it.

---

## Part 4 — What this says about the testing we already had

The 41 automated checks are good and they pass; they are also all of one shape — *can A reach B's
things?* Every finding in Severity 1 and 2 above is a different shape: a user damaging their own
record, the same request sent twice, a value that is syntactically fine and semantically absurd,
and an answer that is technically true and practically misleading.

The suite should grow a second half: **self-damage**, **repetition**, **boundary values**, and
**honest answers**. That is a cheaper lesson to take from this report than any individual fix.
