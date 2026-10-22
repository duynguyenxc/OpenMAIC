# Security test report

**Duy Nguyen · 22 October 2026 · Levels 2 and 3**

Instruction v3 asks for this at completion, and v2 for "security test results". Both are below,
with how to reproduce them.

## How to run it yourself

```bash
cd ~/Downloads/OpenMAIC
BASE_URL=https://openmaic-level2.vercel.app node scripts/level2-security-tests.mjs    # 58
BASE_URL=https://openmaic-level2.vercel.app node scripts/level3-research-tests.mjs    # 46
BASE_URL=https://openmaic-level2.vercel.app node scripts/level3b-assessment-tests.mjs # 42
BASE_URL=https://openmaic-level2.vercel.app node scripts/level3c-knowledge-tests.mjs  # 35
BASE_URL=https://openmaic-level2.vercel.app node scripts/level3d-media-tests.mjs      # 42
npx vitest run tests/level3                                                           # 23
```

Every suite names its fixtures after the run and deletes them afterwards, so they are safe against
the live site. `SKIP_LLM=1` skips the checks that call a model.

**223 API checks and 23 unit tests, 0 failures**, against both the local server and the deployment.

## What the instruction asked to be tested, and where it is

| v3 asks for | Where |
|---|---|
| **Unit** — permissions, rubric parsing, template cloning, study configuration | `tests/level3/permissions.test.ts` (23) |
| **Integration** — enrolment, course authorization, learner runtime, assessment pipeline, knowledge retrieval | the five API suites, end to end against a real database |
| **Security** — cross-course access, cross-institution access, student impersonation, instructor privilege escalation, unauthorized research export | below |
| **End to end** — admin creates institution/study → instructor clones and enrols → student works → instructor sees results → researcher exports | `level3-research-tests.mjs`, which performs exactly that sequence |

## The security findings, by attack

### Cross-course access
- Instructor 2 reading Instructor 1's course → **403**. Measured before and after the Level-2
  change: **200 with the full 104 KB document before, 403 after.**
- A student opening a course they are not enrolled in, by exact address → **refused by the
  server**, with a page that explains rather than an error.
- A course id of `../../etc/passwd` → **403**, not a crash and not a hint that it exists.

### Cross-institution access
- Three instructors at three institutions clone one template. Each sees **only their own section**;
  Instructor-UK cannot read Course-US results; Instructor-US cannot enrol into Course-AU.
- **Institution membership grants nothing.** Belonging to the same institution as a course does not
  open it, and that is asserted rather than assumed.

### Student impersonation
- Two requests differing **only** in the body's `learnerKey` → **201** and **403
  FORBIDDEN_LEARNER**. Learner identity is derived from the session; the browser cannot claim it.
- A student requesting another student's runtime, results or feedback → refused in every case.
- A student submitting a response to a course they are not enrolled in → refused.

### Instructor privilege escalation
- A student attempting to create a course, change a role, attach a rubric, run an assessment,
  review one, create an institution, a study, a knowledge resource or an agent configuration →
  **refused in every case**, with nothing half-created left behind.
- An instructor attempting to create an institution or an LMS integration → refused; those are
  administration.
- **Self-damage**, which an earlier suite could not catch: an owner can no longer demote themselves
  out of their own course (**409 OWNER_CANNOT_BE_DEMOTED**), and the owner row survives the attempt.

### Unauthorized research export
- Unauthenticated → refused. A student → refused. **An instructor who teaches a section in the
  study → refused**, which is the one most likely to be got wrong.
- An `OBSERVER` on a study may read it and **may not export it**.
- The export contains **no email, no name, no student number** — asserted by searching the exported
  text for `@example.test` and finding none.
- A participant who declined consent is **excluded**, and the count of exclusions is reported with
  the data.

### Unauthenticated access
- Six endpoints with no session → **401** each: `/me`, `/courses`, `/admin/users`, `/api/stages`,
  a course's results, a course's export.
- The anonymous page shell leaks no account, identifier or `NEXT_PUBLIC_` value.

### Credentials
- The audit log is searched for anything matching `password|secret|token|apikey` → **none**.
- No API key reaches a browser; provider credentials are server-side only.

## Transport and headers, on the deployment

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Content-Security-Policy` | `frame-ancestors 'self'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), geolocation=(), payment=(), microphone=(self)` |

Database connections are TLS, verified through `pg_stat_ssl`. Row-level security is enabled with no
policies and `anon`/`authenticated` revoked on every table in both levels — defence behind the API,
not instead of it.

## What this report does not claim

- **No penetration test by a third party.** These are the author's own adversarial tests.
- **No rate limiting of our own** on sign-in; Supabase applies its own.
- **The certificate chain to the database is not fully verified** (`uselibpqcompat`), which is a
  known shortcut recorded since Level 2 and should be closed before real student data.
- **Quiz and PBL records have never existed here**, so authorization over them is proven by
  construction and not by measurement.
