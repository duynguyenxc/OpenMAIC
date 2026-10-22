# API reference — Levels 2 and 3

**Duy Nguyen · 21 October 2026**

Every route below authorizes **on the server, on every request**. The interface hides what a person
may not do as a courtesy; hiding is never the protection. Routes are grouped by the question they
answer, and each names the check it performs.

Authentication is a Supabase session cookie. There are no API keys, and no route accepts an
identity from the request body — `learner_key` is always derived from the session, which is what
makes a learner record attributable at all.

Errors are `{ "error": { "code": "...", "message": "..." } }` with a meaningful status:
`400` malformed, `401` not signed in, `403` not allowed, `404` no such thing (or none you may see),
`409` a conflict you can resolve.

---

## Level 2 — identity, courses, people

### `GET /api/level2/me`
Who this request is. Used by every dashboard to decide where to send you. **Any signed-in account.**

### `GET /api/level2/courses`
The courses you may see: your own and those shared with you; an administrator sees all; a student
sees the published courses they are actively enrolled in. **Any signed-in account**, and the list is
the authorization — there is no "all courses" mode for a non-administrator.

### `PATCH /api/level2/courses/<stageId>`
Rename, publish, unpublish, archive. **Owner or administrator.**
Body: `{ title?, status? }` where status is `DRAFT | PUBLISHED | ARCHIVED`.
`400 INVALID_TITLE` empty or over 200 characters · `409 TITLE_IN_USE` that owner already has a
course with the name · `400 INVALID_STATUS`.

### `DELETE /api/level2/courses/<stageId>`
**Owner or administrator.** Two outcomes, decided by the data and not by the caller:
a course with **no learner sessions** is deleted with its grants and enrolments; a course that holds
learner sessions is **archived** and every record kept. An administrator may force a real delete by
sending `{ confirmTitle }` matching the course title exactly. The OpenMAIC lesson document is never
touched — it stays in the instructor's workspace.

### `POST /api/level2/courses/<stageId>/duplicate`
A copy with a new id, the caller as owner, no students and no learner data. **Any instructor
entitled to the source.** Two identical calls moments apart return the same course once, under an
advisory lock, rather than creating two.

### `GET|POST|DELETE /api/level2/courses/<stageId>/enrollments`
The roll. Listing: **any instructor on the course.** Changing: **owner.**
`POST { email }` reports `outcome` as `enrolled`, `reactivated` or `already-enrolled`.
`DELETE ?email=` sets the enrolment INACTIVE — access stops, the learner's work is kept.
`400 MALFORMED_EMAIL` · `400 NOT_A_STUDENT` · `404 NO_SUCH_USER`.

### `GET|POST|DELETE /api/level2/courses/<stageId>/instructors`
The teaching team. Listing: **any instructor on the course.** Changing: **owner.**
`POST { email, permission }` where permission is `EDITOR | VIEWER`.
**`409 OWNER_CANNOT_BE_DEMOTED`** — the owner's row cannot be altered here; handing a course over is
its own operation. `DELETE ?email=` removes a grant and never the owner's.

### `POST /api/level2/courses/<stageId>/owner`
Transfer ownership. **Owner or administrator.** Body `{ email }`. In one transaction the previous
owner becomes `EDITOR` and the new one `OWNER`, so the course is never left with two owners or none.

### `GET /api/level2/courses/<stageId>/results`
Per-student counts for the course, or one student's trajectory with `?email=`.
**Any instructor on the course.**
`404 NOT_ENROLLED` for an address that is not on the roster — distinguishable from a student who is
enrolled and has done nothing, which answers `200` with an empty list.

### `GET /api/level2/courses/<stageId>/export?format=csv|json`
The course's learner data, identified, for the instructor who teaches it. **Any instructor on the
course.** This is the *teaching* export; the de-identified research export is a different route with
a different check.

### `GET|PATCH /api/level2/admin/users`
Accounts, roles and status. **Administrator.** An administrator cannot change their own role, in the
interface or here, so the last one cannot lock everybody out.

---

## Level 3 — institutions, templates, studies, research data

### `GET|POST /api/level3/institutions`
Listing: **any signed-in account.** Creating: **administrator.**
Institutions group people and sections. **They never grant access to a course** — course permission
stays with ownership and enrolment, which the instruction states outright.

### `GET|POST /api/level3/templates`
The shared module library. **Instructors, researchers and administrators; `403` for students**, who
do not browse template libraries.
`GET` returns what you may see: your own, your institution's, and the community's.
`POST { stageId, title?, version?, visibility?, discipline?, tags? }` publishes a course you are
entitled to. `409 VERSION_EXISTS` — raise the version rather than editing a published design, so a
running study keeps pointing at what it started with.

### `POST /api/level3/templates/<templateId>/clone`
Make a section of your own from a published module. **Anyone who may see the template; `403` for
students.** The copy gets a new course id, your ownership, an empty roll, **no learner runtime**, and
a `configuration_snapshot` frozen at this moment. Response states `learnerRuntimeCopied: false` and
`enrolmentsCopied: false` because those are the guarantees, not side effects.

### `GET|POST /api/level3/studies`
Listing: the studies you lead or were added to; an administrator sees all; **`403` for students.**
Creating: **administrator**, with `{ title, description?, principalInvestigator?, protocolIdentifier?, status?, startDate?, endDate? }`.

### `GET|POST /api/level3/studies/<studyId>/courses`
Which sections are in the study, and under which condition.
Listing: **study access.** Adding: **administrator**, with `{ stageId, condition?, cohort? }`.
Condition labels are free text — the platform assumes no particular set.

### `GET|POST /api/level3/studies/<studyId>/participants`
Listing: **study access.** An administrator sees the link between a person and `P-00031`
(`identified: true`); everybody else sees participant ids alone (`identified: false`).
`POST { email, consentStatus }` registers a participant and records consent. Identifiers are
allocated under a lock so two learners entering at once cannot take the same number.

### `POST /api/level3/studies/<studyId>/project`
Rebuild the study's research events from OpenMAIC's own runtime records.
**`RESEARCHER` or `DATA_MANAGER` on the study.** Idempotent: running it twice writes nothing the
second time. Reports what it examined, wrote, and **skipped as a kind it does not map**.

### `GET /api/level3/studies/<studyId>/export?format=csv|json`
The de-identified research export, with its data-quality report.
**`RESEARCHER` or `DATA_MANAGER` on the study** — an `OBSERVER` may read a study on screen and not
export it, and an instructor teaching one of its sections cannot export it either.
Contains no email, no name, no student number. Only consented participants unless
`includeAllConsentStates=true`, which is recorded in the audit log.
Columns: `docs/DATA_DICTIONARY.md`.

---

## What is deliberately not exposed

- **No unrestricted research export.** Every export is scoped to one study and one authorization.
- **No route accepts a role, an owner id or a learner key from the client.**
- **No API key authentication.** Provider credentials stay server-side; an instructor or student
  never sees one.
- **No bulk endpoint over all courses or all participants.** The absence is the point.
