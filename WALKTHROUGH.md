# WALKTHROUGH — OpenMAIC, as extended for Prof. Wei Zheng

An append-only log. One entry per working session, newest at the bottom. It exists so that a
later session can find out what happened and why **without re-reading the repository**, and
without re-deriving decisions that were already settled. Write the entry when the work is done,
not later from memory.

What belongs in an entry: what was asked, what was built, **what was verified and how**, what was
found and left unfixed, and what the next session must not assume. What does not belong: anything
the commit message already says in full, and anything claimed but not measured.

---

## Context, in one paragraph

**OpenMAIC** is Tsinghua's *Open Multi-Agent Interactive Classroom* — an AI teacher, AI classmates
and generated slides, driven by one person at a browser. Prof. Wei Zheng asked for it to be
installed and then extended in levels. **Level 1** is the platform as published, deployed and
running. **Level 2** turns it into something a real class can use: accounts, three roles, and
isolation between people. **Level 3** has not been started.

This repository is a fork of `THU-MAIC/OpenMAIC`. `origin` still points at Tsinghua so upstream
stays pullable; our work is pushed explicitly to `https://github.com/duynguyenxc/OpenMAIC.git`,
branch `feature/level2-rbac`.

**This is a separate project from the realist evidence synthesis work** in
`~/Downloads/Realist-Evidence-Synthesis-V2`. Nothing from that project has been imported here, and
nothing here belongs there.

### Where to read what

| Question | File |
|---|---|
| Does it meet the professor's instruction? | `docs/LEVEL2_PROGRESS.md` — all 22 items, ticked or not |
| What exactly did we change in OpenMAIC's own code? | `docs/UPSTREAM_DELTA.md` |
| How is the isolation actually enforced? | `docs/LEVEL2_SECURITY_MODEL.md` |
| How do I hand this to someone? | `docs/HOW_TO_TEST.md` (accounts, passwords, step by step) |
| What can it not do? | `docs/WHAT_IT_DOES_AND_LIMITS.md` |
| The database | `docs/LEVEL2_DATABASE_SCHEMA.md`, `docs/LEVEL2_DATABASE_ACCESS.md` |
| Per-role instructions | `docs/ADMIN_MANUAL.md`, `INSTRUCTOR_MANUAL.md`, `STUDENT_MANUAL.md` |
| A recording of the whole thing working | `docs/demo/level2-walkthrough.gif` |

---

## L1 — Level 1 installed and deployed (2026-10-07 → 10-08)

Installed unmodified and deployed to Vercel. The only code change was `35e96692`, holding gated
pages until the access gate resolves: opening a classroom link before the access cookie existed
made the page issue its data requests too early, the middleware answered 401, and the user saw a
storage error that only a manual Retry cleared.

Level 1 is a **separate Vercel project** and nothing in Level 2 may touch it.

---

## L2 — Level 2: accounts, roles and isolation (2026-10-16)

**What was asked.** The professor's `instruction to AI coding agent-v2.docx`: turn the single-user
classroom into a multi-user teaching platform with ADMIN / INSTRUCTOR / STUDENT, where instructors
own their courses and students only reach what they are enrolled in. The document carries a
22-item checklist, tracked item by item in `docs/LEVEL2_PROGRESS.md`.

**The finding that shaped the whole level.** An audit before writing any code
(`docs/LEVEL2_ARCHITECTURE_AUDIT.md`) found OpenMAIC already enforced **three of the four**
learner-security properties below the application layer. Level 2 was therefore not "build
isolation" but "replace the identity source, and authorize course reads" — which is why the delta
in OpenMAIC's own files is seven files and ~259 lines, not a rewrite.

**How it is built.**

- Identity comes from **Supabase Auth**, registered through OpenMAIC's own
  `configureOwnerAuthentication` seam from `instrumentation.ts`. Tokens are **ES256, verified
  against JWKS** — checked before writing any code; an `HS256` secret would never have verified.
- Four new tables, no foreign key into OpenMAIC's own: `user_profiles`, `courses`,
  `course_instructors`, `enrollments`. A partial unique index enforces one OWNER per course. RLS
  is on with no policies and anon/authenticated revoked — defence in depth, not the fence itself.
- The fence itself is the **server**, on every request: `mayReadCourse` on reads, persistence
  hooks on create, `learner_key = 'user:' || auth_user_id` so a learner cannot be impersonated.
- Postgres over the **session pooler, port 5432** (not the 6543 transaction pooler), with
  `uselibpqcompat=true` for node-postgres 8.22. TLS stays on; verified live through
  `pg_stat_ssl`.

**What was verified, and how.** `scripts/level2-security-tests.mjs` — **41 checks, 0 failures**,
run against the live deployment, not only locally. It builds its own courses and students on each
run so it never depends on leftovers. The decisive ones are measured rather than argued: before
the change, instructor2 fetching instructor1's course returned **200 and the full 104 KB
document**; after, **403**. Two requests differing only in the body's `learnerKey` return **201**
and **403 FORBIDDEN_LEARNER**.

**What was not claimed.** Item 14 (retrieve quiz / PBL records) is marked ⚠️. The retrieval is
kind-agnostic by construction, but **no quiz or PBL record has ever existed in this deployment**,
so that half rests on design rather than measurement. The export's quiz and PBL columns are
therefore present and empty — not filled with invented values.

---

## L3 — Handover: the recorded walkthrough, and three bugs it found (2026-10-16 → 10-19)

The task was to record a video of the system working and write a guide the professor could follow.
Rehearsing the walkthrough is what found the bugs; none of them came from a test suite.

**Bug 1 — "Persistence is unavailable."** Reported by the project owner opening the deployed site
while signed out. The root page is OpenMAIC's workspace; it asks for the course list; with accounts
authorizing, that answers 401, and the visitor read an error that looks like a broken deployment.
At Level 1 the shared access code caught such visitors first, so the gap only appeared once the
code was retired. Fixed in `b95a78fb`: the guard asks `/api/level2/me` and sends an unauthenticated
visitor to `/platform/login`. **A network failure is treated as "render anyway", not "signed out"**,
so a dropped request never bounces someone who is signed in.

**Bug 2 — the first sign-in attempt silently failed.** A regression introduced by Bug 1's fix. The
guard remembered the answer "signed out" from the sign-in page; signing in navigated to
`/platform`, and the redirect effect fired against that stale answer before the new one arrived,
bouncing the user back to an empty form. The second attempt always worked. **The first hypothesis
was wrong** — that the automation typed before hydration finished — and letting the page settle for
eighteen seconds disproved it rather than confirming it. Fixed in `9dfad148`: the answer now
carries the path it was obtained for, and only an answer for the current path may redirect.

**Bug 3 — no visible way into the platform.** The project owner opened the link and found the
OpenMAIC chat screen saying "No courses yet", with nothing on it mentioning accounts or courses and
no link to `/platform`. The first fix was to write the correct path in the guide; **that fixes the
guide, not the product**, and fails for anyone arriving by another route. Fixed in `5b8cd715`: a
**Platform** button in the workspace's top-right pill. The component is ours and renders `null`
when Supabase is absent, so Level 1 is untouched.

**Also done.** `docs/demo/level2-walkthrough.gif` — sixteen captioned steps, driven through a real
browser, fourteen against the local server at that commit and two against the deployment. There is
no video encoder on this machine (`ffmpeg` absent, `avconvert` cannot read an image sequence), so
it is a GIF, not MP4. `docs/HOW_TO_TEST.md` was rewritten to lead with what the platform does
before how to test it, and now carries the six accounts **with their passwords** so it can be
handed over as-is.

**Two courses were renamed** to "Demo 1 — Realist Evaluation (Instructor One)" and "Demo 2 —
Instructor Two private course", through the same column the product's own rename writes, because
the database held four courses called "Course A" and four called "Course B" and a reader could not
tell them apart.

### Open, at the end of this session

- **~14 leftover courses** from the security runs, which create their own courses every time. A
  student signing in sees several identical "Course A" cards. Deleting them was **offered and not
  authorized**, so they are still there and the guide says to ignore them.
- **Two live checks the owner must do**, because entering a password into a public site is not
  something this agent may do: that the first sign-in attempt works, and that the Platform button
  is visible. Both were verified on the local server at the deployed commit.
- **A student can still reach OpenMAIC's own workspace** and generate lessons for themselves. Not a
  leak — what they make is theirs — but it spends the shared AI key. Recorded in
  `WHAT_IT_DOES_AND_LIMITS.md` as a decision to make before a real class, not fixed silently.
- **Refusals are worded in technical language** (`document authorization required`). Correct, but
  raw. Cosmetic, not a security problem.
- **Level 3 (`instruction v3`) has not been started.**
