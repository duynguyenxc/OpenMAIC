# Authorization model (Levels 2 and 3A)

**Duy Nguyen · 21 October 2026**

One rule governs everything below: **the server decides, on every request**. The interface hides
what a person may not do as a courtesy; hiding is never the protection. The instruction says it
plainly — *"UI hiding is not security"* — and every check here runs in a route handler, not a
component.

## Platform roles

| Role | What it means |
|---|---|
| `ADMIN` | platform administration: accounts, roles, institutions, studies, every course |
| `INSTRUCTOR` | owns and teaches courses; may be given access to a colleague's |
| `STUDENT` | opens the courses they are enrolled in, and nothing else |
| `RESEARCHER` | reads the studies they are authorized for. **No course permission at all** |

A role is never read from the browser. It comes from `user_profiles`, looked up from a verified
Supabase session, and `coreRoles()` maps it to the capability set OpenMAIC itself understands —
where `RESEARCHER` deliberately maps to the empty set.

## Course access — unchanged by Level 3

| Who | May read a course | May write it |
|---|---|---|
| `ADMIN` | any | any |
| Owner | their own | their own, including publish, enrol, rename, delete |
| `EDITOR` | the courses shared with them | content, and may inspect students |
| `VIEWER` | the courses shared with them | nothing |
| `STUDENT` | only with an **active enrolment** and the course **published** | never |
| Anyone else | no | no |

Two properties that cost a bug each to learn:

- **Knowing a course id is not authorization.** Every read goes through `mayReadCourse`.
- **An owner cannot be demoted into losing their own course.** Offering your own address to the
  co-instructor endpoint returns `409 OWNER_CANNOT_BE_DEMOTED`; handing a course over is its own
  deliberate operation.

## Study access — added by Level 3A

Narrower than course access, and never wider.

| Who | May read a study | May export it |
|---|---|---|
| `ADMIN` | any | any |
| Principal investigator | their own | yes |
| Listed `RESEARCHER` | that study | yes |
| Listed `DATA_MANAGER` | that study | yes |
| Listed `OBSERVER` | that study | **no** |
| An instructor whose course is in the study | **no** | no |
| Everyone else | no | no |

The last two rows are the point. Teaching a section that belongs to a study does not make you a
reader of the study, and reading a study does not make you a teacher of its sections.

## Institutions grant nothing

*"Do not infer permissions solely from institution membership. Course-level authorization remains
authoritative."* Membership is used for grouping, for template visibility
(`visibility = 'INSTITUTION'`), and for reporting. It is never consulted by a course check.

## Learner identity

`learner_key` is always `'user:' || auth_user_id`, derived on the server from the session. The
browser can send whatever it likes; a request whose body names another learner is refused with
`403 FORBIDDEN_LEARNER`. This is what makes an interaction record attributable at all, and it is
tested from both sides.

## Where it is enforced

`lib/level2/authorization.ts` — `requireAuthenticatedUser`, `requireAdmin`,
`requireCourseInstructor`, `requireCourseEditor`, `requireCourseOwner`, `requireCourseEnrollment`,
`mayReadCourse`.

`lib/level3/authorization.ts` — `requirePlatformAdmin`, `requireStudyAccess`,
`requireExportPermission`, `studiesVisibleTo`.

Every route under `app/api/level2/` and `app/api/level3/` calls one of them before touching data.
**104 automated checks** cover this across the two suites.
