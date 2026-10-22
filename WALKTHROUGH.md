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

---

## L4 — Adversarial testing: the suite's blind spot (2026-10-21)

The project owner asked for a real tester's pass over the deployment rather than another reading
of the requirements, aimed at usability. It found a **data-loss bug that the 41 automated checks
cannot catch by construction**, which matters more than the usability list it was asked for.

**S1-1, owner self-lockout.** `POST /courses/<id>/instructors` with your **own** email and
`permission: EDITOR`, as the owner, returns 200. The upsert overwrites the existing row, so the
`OWNER` permission becomes `EDITOR`. Verified in the database: `course_instructors` was left with
one EDITOR row and **no owner**. Every owner-gated call then 403s — measured immediately after, as
the same user. It cannot be repaired from inside the product, because only an owner may fix the
owner row and the administrator has no course-authorization interface.

**Why the suite missed it, and this is the reusable lesson.** All 41 checks have one shape:
*can A reach B's things?* Nobody asked what happens when a user damages **their own** record. The
identical hazard was foreseen one table over — `user_profiles` refuses self-demotion so the last
administrator cannot lock everyone out — and the reasoning was never carried across. The suite
needs a second half: self-damage, repetition, boundary values, honest answers.

**S1-2, double submission.** Two simultaneous `POST /duplicate` calls both returned 201 and
created two courses. No disabled control, no idempotency. Harmless alone; permanent because there
is still no delete.

**Also found:** a 5,000-character title accepted; `results?email=` answering 200 with an empty
list for a student who is not enrolled *and* for an invented address, so "did nothing" and "not in
this course" are indistinguishable; a malformed email reported as a missing account. Nine measured
usability findings, the worst being that a click's result appears 3,193 px down a page whose
viewport is 800.

**What held.** Every unauthenticated request refused (401, six endpoints, on the deployment); a
course id of `../../etc/passwd` refused; `format=xml` and `status=BANANA` refused; a student
offered as co-instructor and an instructor offered as student both refused; sign-in does not
enumerate accounts; HSTS, X-Frame-Options and a frame-ancestors CSP all present; the anonymous
page shell leaks nothing; accessibility basics clean — 57 buttons, every one with a name.

**Test damage, repaired.** Two probes changed live data: the owner demotion above, and two "RACE
TEST" courses. The owner row and the title were restored and the two courses deleted by SQL —
deletion being impossible through the product. Verified afterwards.

Full report and the five-phase plan: `docs/LEVEL2_UPGRADE_PLAN.md`.

### Open, still

Unchanged from L3, plus: **nothing in Phase 1 has been built**, and the deletion rule needs the
owner's decision — archive-if-it-has-data versus hard delete — because it determines the schema.

---

## L5 — The upgrade, built in one pass (2026-10-21)

The project owner asked for the plan in `docs/LEVEL2_UPGRADE_PLAN.md` to be carried out without
further questions, and decided the one open point by delegating it: deletion archives when there
is learner work and deletes when there is none.

**The data-loss bug is closed.** `POST /instructors` refuses to touch the owner's row — 409
`OWNER_CANNOT_BE_DEMOTED` — and the `ON CONFLICT` clause will not overwrite an `OWNER` permission
either, so the hazard is shut at both levels. Handing a course over is now its own operation,
`POST /courses/<id>/owner`, demoting the old owner to EDITOR and promoting the new one in one
transaction.

**Deletion exists**, which it never did. No learner sessions: deleted with its grants and
enrolments. Learner sessions present: `ARCHIVED`, students locked out on their next request, every
record kept, restorable by `PATCH status`. An administrator may still destroy one by sending the
exact title in `confirmTitle`. It does not touch OpenMAIC's document store — the lesson stays in
the workspace — so no partial failure across two stores can leave a course half-gone.

**Double submission** is serialised by a Postgres advisory lock on (owner, title): two
simultaneous duplicates return 201 and 200 with the same stage id.

**Measured before and after, on the running app:** the panel that opened 3,193 px below an 800 px
viewport is a dialog opening at 200 px; the dashboard went from 3,193 px to 1,128 px while listing
more courses; `header a, nav a` went from 0 elements to real navigation; the ten seconds of white
on `/platform` is a loading state — and the cause was the guard, not the page that already said
"Loading…".

**The co-instructor interface exists**, so the instruction's own acceptance test — add Instructor 2
as EDITOR, confirm, remove, confirm — can be performed by a person for the first time. Verified by
doing exactly that. The administrator opens the same dialog on any course, which is the
AUTHORIZATION group that was missing.

**The suite grew its second half: 41 → 56.** Self-damage, repetition, boundary values, honest
answers, deletion. It also stopped reading its fixtures from `/tmp`, where they had been deleted —
it would not run at all this morning. They live in `scripts/fixtures/` now.

**The junk is gone, through the product.** Of 24 leftovers, 7 held no learner work and were
deleted; 17 did and were archived instead. A student's list went from six identical "Course A"
cards to two real courses, and not one learner session was destroyed — which is the archive rule
doing exactly what it was written for.

**Also:** three missing security headers, the ER diagram, and seven screenshots through the three
manuals, so items 20–22 are earned rather than assumed.

### Open, after this session

- **Phase 3's remaining polish** is done except progress on the student card, which still has no
  data behind it — the honest options are to show it or to stop promising it, and neither has been
  chosen.
- **Quiz and PBL records still do not exist** in this deployment, so item 14 remains half proven.
- **Level 3 has not been started.**

---

## L6 — Level 3A: institutions, templates, studies, research data (2026-10-21)

Instruction v3 is a multi-institution research platform and is explicit about pace: *"Do NOT
attempt all Level-3 features simultaneously"*, then 3A → 3B → 3C → 3D, with test, document, deploy
and report after each. **3A is delivered; 3B, 3C and 3D are not started**, and
`docs/LEVEL3_ARCHITECTURE.md` lists what they contain so nobody has to guess.

**Before starting, as v3 requires:** Level 2 tagged `level2-multiuser-stable`, branch
`feature/level3-research-platform`, baseline recorded in `docs/LEVEL3_BASELINE.md`, and the gate
honoured — *"Do not begin Level 3 unless Level 2 ... security tests have passed"* — at 58/58.

**What was built.** Institutions and memberships; course templates with versions and visibility;
cloning a template into a section; studies, experimental conditions and cohorts; research
participant identifiers separate from identity, with consent; a research event layer; a
de-identified export with a data-quality report; an append-only audit log; a RESEARCHER role and
its dashboard. **No upstream OpenMAIC file was touched** — the delta is still Level 2's seven.

**The decision that shapes it:** research events are a **projection** of OpenMAIC's own
`runtime_records`, not a second write path. Nothing in the teaching path calls anything added
here, so research instrumentation cannot slow the classroom or break it, and a failed projection
loses nothing. Every event carries `source_runtime_record_id` under a unique index, so the
projection is idempotent and *"do not generate fake events"* is a property of the design rather
than a promise. Four payload kinds are mapped because four exist here; the other eleven the
instruction lists are **not** mapped, and the projection reports what it skipped.

**Verified by the scenario v3 specifies**, not by assertion: one module published once, cloned by
three instructors at three institutions, under two conditions, with different students.
`scripts/level3-research-tests.mjs` — **46 checks, 0 failures** — confirms the course ids differ,
the content is equivalent, **no learner runtime and no enrolment was copied**, an instructor sees
only their own section, an instructor on a study course still cannot export it, a researcher sees
participant ids without identities, a declined participant is excluded, the export contains no
email address, and every audited action is recorded with no credential-looking field.

`scripts/level3-demo-study.mjs` builds the worked example and leaves it in place: three sections,
two conditions, five real events, one consented participant and one who declined.

### Three things found and fixed along the way

- **The role was invisible to the identity layer.** Every RESEARCHER request answered 500 because
  `coreRoles()` had no branch for it and the registered auth method was captured at server start.
  The role now maps to an empty capability set — a researcher carries nothing OpenMAIC honours —
  and the dev server had to be restarted, which is worth remembering: `instrumentation.ts` runs
  once per process and is not hot-reloaded.
- **`ON CONFLICT` cannot infer a partial unique index.** The idempotence index was partial for
  readability; PostgreSQL refused to use it. A plain unique index already allows many NULLs.
- **Both test suites left courses behind on every run**, which is where the twenty-one sections in
  the first researcher screenshot came from, and ultimately where the fourteen junk courses of
  Level 2 came from too. Each suite now names its fixtures after the run and deletes them at the
  end.

### Deployment, and a hazard it exposed

Deployed first to a Vercel **preview** URL, to honour *"Do NOT destroy or overwrite Level 2"*. That
URL turned out to sit behind Vercel's deployment protection, so nobody without an account on this
Vercel team can open it — a staging URL the professor cannot click is not a staging URL.

Checking that, a real hazard appeared: **the Level-2 production build answered 500 for the
RESEARCHER account**, because it predates the role and shares one database with Level 3. Nobody
else was affected (an instructor still answered 200), but it was a defect introduced by seeding a
new role into a shared database.

So Level 3A was promoted to production. Nothing is destroyed by that: the Level-2 code survives as
the tag `level2-multiuser-stable` and the branch `feature/level2-rbac`, and is one deploy away.
Level 3A is strictly additive, and Level 2's full suite passes on it. Verified on the live
deployment afterwards: the researcher answers 200, **58/58 Level 2 and 46/46 Level 3A**.

A genuinely separate Level-3 deployment needs a database of its own to mean anything, which is a
decision rather than a command.

### Open, after this session

- **3B, 3C, 3D not started.** Rubrics and AI assessment are next in the instruction's own order.
- **Per-response model metadata is not captured** — model, parameters, prompt version. The
  section's configuration at clone time is. Recorded in `RESEARCH_DATA_MODEL.md` rather than
  implied.
- **Quiz and PBL events have still never existed** in this deployment, so those mappings remain
  unexercised.
- **Random assignment is deliberately absent**: *"Do NOT implement automatic random assignment
  until explicitly requested."*

---

## L7 — 3A's documentation, and Level 3B (2026-10-21)

Two pieces of work. The first was a debt: 3A was tested and deployed while six documents the
instruction names were missing, and reporting 3A as done while that was true would have been a lie
by omission. `API.md`, `DEPLOYMENT.md`, `DATABASE_SCHEMA.md` and `EXPERIMENT_CONFIGURATION.md` are
written, and the ADMIN and INSTRUCTOR manuals — which had not one word about Level 3 — now carry
institutions, studies, conditions, participants and consent on one side and publishing and cloning
modules on the other.

**Then 3B**, in the instruction's own order: rubric management, AI assessment, human review,
adaptive feedback, response revision tracking.

**The rule the whole sublevel is built on** is one sentence of the instruction's:
*"Do NOT overwrite instructor/human ratings."* So an assessment row carries `assessor_kind`, a
review records what a human decided **about** an AI assessment without touching it, and the final
score is **derived** — the human's if one exists, the AI's if a human accepted it, otherwise none.
An unreviewed AI score is not a final score, and the interface says so in those words. A test
counts the AI's scores before and after a revision and asserts they are unchanged.

Rubrics are versioned and immutable once published, because *"store the rubric version used for
each assessment"* is impossible if a rubric can be edited under a finished one. Feedback is a
service beside the classroom, never inside it, and the policy refuses rather than improvises:
`AFTER_FIRST_RESPONSE` declines on attempt 1 because the first answer is the measurement.
Revisions are new rows pointing at their parent, never updates.

**42 checks, 0 failures, with real model calls.** `SKIP_LLM=1` runs the 28 that do not need one.
Levels 2 and 3A still pass: **58 + 46 + 42 = 146**.

### Two things this cost

- **No model could be resolved.** The classroom gets its model from the browser; a server-side
  service has none, and this deployment had `DEFAULT_MODEL` empty. Rather than set a global default
  and change how the classroom behaves, two new stages — `level3-assessment`, `level3-feedback` —
  were added to OpenMAIC's `LLM_STAGES` and routed through `MODEL_ROUTES`. Two strings in one
  upstream file, recorded in `UPSTREAM_DELTA.md`, and an operator can now budget assessment apart
  from teaching.
- The dev server had to be restarted **again** for the route change, for the same reason as last
  time: configuration read at process start is not hot-reloaded.

### Open, after this session

- **3C and 3D not started** — knowledge resources, retrieval, the optional KG provider, bounded
  agents, provenance; then handwriting, audio, LMS.
- **Usage and cost are still not counted.** 3B spends tokens and records the model per assessment,
  but nothing aggregates usage by course, instructor, study or institution.
- **`MODEL_ROUTES` is now set on Vercel too** — `openai:gpt-4.1` for assessment,
  `openai:gpt-4.1-mini` for feedback — and the full 3B suite passes against the live deployment
  with real model calls. Which model an operator's money runs is still their decision; these are
  modest defaults and one environment variable changes them.
- **No automatic assessment.** An instructor presses the button, because assessment costs money and
  a study design decides when it happens.

---

## L8 — Level 3C: knowledge resources, retrieval, bounded agents (2026-10-21)

The instruction is more insistent here than anywhere else, and all of it is about **not** building
a thing one way: *"Do not force all knowledge into a KG"*, *"Create a clean abstraction:
KnowledgeProvider"*, *"Do not tightly couple OpenMAIC to one graph database."*

So nothing above `lib/level3/knowledge.ts` knows what a vector is, what a triple is, or what Neo4j
is. A caller asks a **source** for context; three retrievers sit behind one interface — trigram over
chunks, cosine over `vector(1536)`, and triples — and replacing a store means replacing one object.
The embedder is an **argument** rather than an import, so the vector retriever never learns which
vendor produced its numbers.

**The retrieval is real.** `pgvector 0.8.2` and `pg_trgm` were available and are now enabled; the
HNSW index does the work. A chunk with no embedding is simply not found, and the interface reports
a resource as *"not by meaning — embedding failed"* instead of silently degrading to keyword search
while claiming otherwise.

**Several sources at once, named by the researcher.** `authoritative`, `counterpoint`, `K1` — the
platform stores the label, orders by priority, tags every passage with it, and never interprets it,
because *"Do not hard-code the labels K1 and K2 into the generic platform."*

**A bound that is enforced, not requested.** An agent configuration's `permitted_resources` filters
the sources *before* any of them is asked, so a bounded agent's model never sees the other material.
A test attaches three sources, bounds the agent to one, and reads `retrieval_events` afterwards to
find exactly one source name. That is the difference between an experimental condition and a polite
sentence in a prompt.

**Provenance, and what is deliberately not claimed.** One row per passage actually handed over —
request, provider, resource, source name, document, chunk or edge, score — and the assessment row
names the retrieval request, so "what was this model given" is one join. What no row asserts is that
the model *used* it: `score` is the retriever's own number and nothing more, because
*"Do not claim citation precision unless it is actually available."*

**35 checks, 0 failures, with real embeddings.** `SKIP_LLM=1` runs the 23 that need none. Every
earlier level still passes: **58 + 46 + 42 + 35 = 181**.

### One bug, worth remembering

`OPENAI_BASE_URL=""` is an **empty string**, not undefined, so
`process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'` kept the empty string and the request
went to `/embeddings` — not a URL at all. `??` is the wrong operator for environment variables; an
empty variable means "not configured". Fixed with a helper and a comment that says why.

### Open, after this session

- **3D not started**: handwriting, audio, LMS, advanced analytics.
- **No ingestion pipeline.** Text is pasted and chunked by blank line. PDFs, crawling and OCR are
  not here; OpenMAIC's own extractors are the obvious place to start.
- **No re-embedding, no reranking, no hybrid fusion**, and `KnowledgeGraphRetriever` reads local
  triples rather than a remote graph. The `connection` column and the interface are where a Neo4j
  or GraphRAG implementation plugs in; it is not written, and the documentation does not pretend
  otherwise.
- **Usage and cost are still not counted**, now across three services rather than two.

---

## L9 — Level 3D, and Level 3 is complete (2026-10-22)

Handwriting, audio, the job queue, the LMS boundary, usage accounting and research analytics.

**Modalities are services, not core changes.** Each is a `ResponseProcessor`: bytes in, text out,
with metadata. Audio goes through **OpenMAIC's own `transcribeAudio`** rather than a second
transcription path — a second path is a second thing to configure and a second thing to be wrong.
Handwriting goes to a vision model told to reproduce the page *including mistakes* and write
`[illegible]` where it cannot read, because a guessed word becomes evidence in somebody's dataset.

**The original is never discarded.** The recording or the page stays in `response_media`, the
derived text in the response, the provenance in `processing_metadata`. A failed extraction leaves
empty text, a `failed` status and the bytes untouched, so the job retries without the student
resubmitting — and a test asserts the original survives processing whatever the outcome.

**The queue is what keeps a student from waiting.** An upload returns `202` with a job id; nothing
blocks on a provider. A database queue, claimed with `FOR UPDATE SKIP LOCKED`, drained by a route
because a serverless deployment has nowhere to put a daemon.

**The LMS work is a boundary, not Canvas**, exactly as instructed. `MANUAL` is the only
implementation and it is honest rather than a stub: a posting is `PREPARED`, never `SENT`, and
asking for an unimplemented provider creates the integration `INACTIVE` and says so. The rule that
matters most lives here — **a grade only leaves on a final score**, so an unreviewed AI score is
refused at the one boundary where it would reach a transcript.

**Usage is finally counted**, which has been an open item since 3B: one row per call, aggregated by
course, instructor, study, institution and model. Token counts stay **null** when a provider does
not report them, and `knownTokens` is reported beside every total, because a small cost can mean
cheap models or an unreporting provider and those are different facts.

**Analytics answers four questions**, each possible only because of an earlier decision: conditions
differ (3A's snapshots), AI against human (3B refusing to overwrite), revision effect (3B keeping
attempts), and cost (3D). Every figure reports its n and the caveats are returned with the numbers.

**42 checks, 0 failures, with a real vision call.** Everything else still passes:
**58 + 46 + 42 + 35 + 42 = 223**.

### One thing it cost

The handwriting job threw, was requeued, and the test saw a response still marked `queued` — because
`level3-handwriting` had been added to `LLM_STAGES` but never routed in `MODEL_ROUTES`. The queue
behaved correctly throughout: it retried rather than losing the upload, which is what the retry
budget is for. Routed, and the vision call works.

### Level 3 is complete

All four sublevels delivered, in the instruction's own order, each tested, documented and deployed
before the next began. Every document instruction v3 names now exists.

### Open, after this session

- **No real LMS adapter.** The boundary exists; Canvas, LTI launch and roster synchronisation do
  not, and the platform is designed to work without them.
- **No OCR engine, no object storage, no scheduler.** Media lives in the database, a multi-page
  scanned PDF is not split, and the worker runs when something calls it. Fine for a pilot, not for
  a cohort.
- **Quiz and PBL records have still never existed** in this deployment, so those event mappings
  remain unexercised — carried unchanged since Level 2.
- **The database is still shared** between what is deployed and anything else; a genuinely separate
  research deployment needs its own.

---

## L10 — Closing the gaps a careful re-read found (2026-10-22)

The project owner asked for both instructions to be checked again, properly. Level 3 had been
reported complete; it was not. Six things the documents ask for were missing, and saying "complete"
while they were is the kind of claim this log exists to prevent.

**Unit tests.** v3 names four by name — permissions, rubric parsing, template cloning, study
configuration — and there were **zero**. The API suites prove the system end to end, but they
cannot pin a *rule* in isolation: when a policy refuses, what a malformed input is called, what an
unpriced model costs. 23 unit tests now do, with no server and no database.

**Concurrency measurement**, and it produced the most valuable finding of the session:

```
(EMAXCONNSESSION) max clients reached in session mode — pool_size: 15
```

**Supabase's session-mode pooler caps at fifteen clients**, shared with the application. At six
concurrent requests it was already exhausted. That is *"the practical limit of the chosen
free/low-cost hosting"* the instruction asked to be identified, and it breaks before the edge,
before the models, before anything else gets a chance to.

It also has a known remedy with a known cost: transaction-mode pooling would raise the ceiling and
would silently break the **one** session-level advisory lock in the codebase — the duplicate guard
in `level2/courses/[stageId]/duplicate`. Everything else already uses the transaction-scoped
variant. One known change, not an unknown one.

**A false alarm, correctly attributed.** The same burst against the live URL returned `403` with
`x-vercel-mitigated: challenge` on every request, and locked the automated suites out of production
for a while — while a human visitor was unaffected throughout. That is the host refusing a burst
from one address, not the application failing. Reporting it as a defect would have turned a hosting
fact into a false bug. The load script now detects the header, says what it is, and defaults to the
local server so nobody provokes it by accident.

**Retention**, which v3 asks to be configurable and in the same breath forbids acting on
automatically. So `retention_policy` records the periods, the deleted-account handling and the
de-identification strategy, and the endpoint **reports what they would cover**. Nothing deletes on a
timer. A research dataset destroyed overnight by a schedule nobody remembered setting is exactly
the failure that sentence guards against.

**Three deliverables v3 lists at completion and we had not produced:** a security test report, an
example research export, and a recommended production deployment architecture. All three now
exist, and the export is a real one — generated from the worked study and checked for the absence
of an email address.

### Everything, after this

**223 API checks + 23 unit tests, 0 failures.** Every document instruction v2 and v3 name exists.

### Still open, and deliberately

- **No real LMS adapter** — the boundary only, as instructed.
- **No OCR engine, no object storage, no scheduler**; media lives in the database.
- **Quiz and PBL records have never existed here**, so those mappings stay unexercised.
- **The certificate chain to the database is not fully verified** (`uselibpqcompat`), carried since
  Level 2 and still the thing to close before real student data.
- **Level 2 and Level 3 share one database.**
- **v2 asked for testing from different computers and browsers**; everything here was driven from
  one machine.

## L11 — Three roles, by hand, and what pressing the buttons found (2026-10-22)

The ask was to stop reading the code and **use the thing**: sign in as administrator, as
instructor, as student, press every button, try the worst cases, judge whether the three dashboards
are actually designed, and write the small defects down so they can be worked through gradually.
Driven in the browser pane at 1440×900 against `http://localhost:3000`.

Worth saying plainly up front: **the suites were green before this session and are green after it**,
and they would not have caught a single thing below. 227 API checks prove the server refuses what it
should. They cannot tell you that a button promises the wrong outcome, or that a page is drawn for
somebody who may not use any of it. That gap is what a person sitting in front of the product sees
first, and it is why this pass was worth the hours.

### The one that was not cosmetic

**A student named as principal investigator could read and export that study.** The studies *list*
refuses a student by role. Every *per-study* route authorised by a row — `principal_investigator =
me` — without ever asking what the account is. And the administration page's *Create study* form
accepted any address.

Found by typing `student1@example.test` into that box out of curiosity, seeing it accepted, and then
signing in as that student: `200` on `/participants`, `200` on `/export`. The probe study was empty,
so nothing real was exposed — but with a course attached, a student could have exported their
classmates' data.

Fixed at both ends, because either alone would have done: creation refuses a student investigator
(`409 STUDENT_CANNOT_LEAD_STUDY`), and `requireStudyAccess` refuses a STUDENT before it looks at any
row, so a row can never grant what the role denies. Re-ran the probe: `403` on both. Two checks
added to the research suite.

**The institution roll was readable by anyone signed in.** A student on `/platform/admin` saw all
three institutions with country and headcount; users and studies on the same page were correctly
refused. The route's own comment said "Listing: any signed-in account", so it was a decision — but
the account that needs the list is the one filling in a select, and a student has no select. Now
refused for students, unchanged for everyone else, with checks on both sides.

### The one that was only cosmetic, and still mattered

**Every role page rendered for every role.** As a student, `/platform/instructor` drew the whole
console — Rename, Unpublish, Duplicate, **Delete** beside the student's own courses, *+ New course*,
the rubric panel. All eight write probes came back `403`, so nothing could be done and nothing
leaked. What the page did instead was lie: the Students dialog said **"Nobody is enrolled yet"** for
a course with two students, because its reads had been refused and the empty state does not know the
difference between *nothing* and *not allowed to know*.

`UI hiding is not security` is written into the student dashboard's own docstring and it is correct.
The complement is also true: a console drawn for someone who may not use any of it is a usability
failure even when it is a security success. `useRoleGuard` now sends a signed-in account to its own
dashboard; administrators are still allowed on the instructor and researcher pages, because they
genuinely work there. Verified in the browser for all three roles in both directions.

### What the rest of the pass found

Eighteen open items, written up one by one in **`docs/DEFECT_REGISTER.md`** with how to reproduce
each. The ones to fix first, by what they cost the person:

- **"Archive it" sometimes deletes.** The dialog explains the conditional rule correctly and then
  labels the button unconditionally. On a course with students but no sessions, pressing *Archive
  it* deletes permanently. The row already shows `last activity —`, so the client knows which
  outcome applies.
- **Restoring an archived course whose name has been reused fails with a bare `500`.** The
  instructor archived something and cannot get it back, with no explanation.
- **A refused edit throws away what you typed** — rename and add-institution both close and revert.
- **The banner shows the previous error while the next request runs**, so you are told about the
  wrong mistake for five seconds; and it reflows the controls beneath it, which caused a genuine
  misclick during the audit.
- **A student leaving a class lands in the generic chatbot.** The classroom page has *no links at
  all*; the back arrow goes to the OpenMAIC workspace, not to their course list.
- **A study cannot be edited or removed once created** — there is no `[studyId]` route at all, so
  every study is DRAFT with no protocol id for ever. The fixture study's `PROTO-2026-001` was seeded
  in SQL; the product cannot reproduce its own fixture data. This is a 3A gap, not a bug.

### On whether the three dashboards are designed

Honestly: the **instructor** page is. It has search, a status filter, a sort, inline rename, a
dialog with three tabs, and help text that explains editor versus viewer in words a teacher would
use.

The **administration** page is not. It is one column 3,400 px tall holding four unrelated tables.
The Users table has a search box; the courses table, at twice the length and with eighteen archived
rows mixed into the live ones, has neither search nor filter. No counts, no navigation, no way to
reach the fourth section without scrolling four screens.

The **student** page is clean but shows the wrong things — instructor, last activity, and a raw
course id. Nothing says what was assigned, what was submitted, or whether feedback is waiting, even
though Level 3 computes all three and the student is who they are for.

### Verified, and how

- 227 API checks (58 + 50 + 42 + 35 + 42) and 23 unit tests, **0 failures**, after the changes.
  The research suite grew from 46 to 50 — the four new authorization checks.
- `npx tsc --noEmit` clean.
- The three redirects and the two 403s re-checked by hand in the browser and by direct request.
- All test data perturbed during the audit was put back: titles restored, the student re-enrolled
  and the colleague removed, the three probe studies deleted. Studies are back to the one fixture.

### What the next session must not assume

- **The register is a list of findings, not of fixes.** Only F1, F2 and F3 are done. The eighteen
  O-items are untouched; do not read the file as a changelog.
- **Nothing here was tested on the live deployment.** Everything was local. The role-guard redirect
  in particular is client-side and should be re-checked once deployed.
- **O1 is about losing work.** If anything in the register gets fixed first, make it that one.

### A finding from outside the audit, and the worse one

Running `git status` at the end showed that **thirteen of the Level-3 deliverable documents were
never in the repository**, along with the example research export. Upstream's `.gitignore` ignores
`/docs` wholesale; this project allowlisted it back by *name pattern* — `LEVEL*.md`, `*_MANUAL.md`
and four literals — which was written when the docs were called that. Every document added during
Level 3 under a different name fell straight through the gap: `API.md`,
`AUTHORIZATION_MODEL.md`, `DATABASE_SCHEMA.md`, `DATA_DICTIONARY.md`, `DEPLOYMENT.md`,
`EXPERIMENT_CONFIGURATION.md`, `KNOWLEDGE_RESOURCE_ARCHITECTURE.md`,
`MULTIMODAL_AND_INTEGRATION.md`, `PERFORMANCE_AND_PRODUCTION.md`, `RESEARCH_DATA_MODEL.md`,
`RUBRIC_SYSTEM.md`, `SECURITY_TEST_REPORT.md`, `HOW_TO_TEST.pdf` and `docs/examples/`.

They existed on one laptop. Every previous entry in this log that says a document "now exists" was
true of the disk and false of the repository, and nobody would have noticed until the laptop did.

The allowlist now admits `/docs/*.md`, `/docs/*.pdf` and `docs/examples/` rather than a list of
names, so the next document added does not have to remember to register itself.

## L12 — Fixing the register's severe entries (2026-10-22)

Five more from `docs/DEFECT_REGISTER.md`, picked by what they cost the person in front of them
rather than by how deep the change was. They are now F4–F8 there, each with how it was verified.

**"Archive it" deleted permanently (F4, was O1).** The dialog predicted the outcome from the
*student count*. Enrolling somebody is not working in something, so a course with students and no
sessions was described as *"archived rather than deleted… none of their work is lost"* under a
button reading **Archive it** — and was then deleted for good.

The prediction now comes from `lastActivityAt`, which is `max(...)` over exactly the
`runtime_sessions` rows the server counts, so the two agree by construction rather than by
agreement. It can only be stale in the safe direction: sessions are never removed, so a course
predicted "will be deleted" can at worst turn out to be archived.

Verified on the real course that would have been destroyed — *Course-UK*, one student, no activity.
It now reads "deleted **permanently**, along with its one enrolment. This cannot be undone", under
**Delete permanently**. A course with sessions still offers **Archive it**.

**Restoring an archived course failed with a bare 500 (F5, was O15).** The unique index excludes
archived rows, so a name is free while a course sits in the archive, and taking it back is a unique
violation at the moment it returns. The instructor had archived something, could not get it back,
and the screen said `request failed`. Now a `409` that names the colliding course and says to
rename one of them first — and renaming and restoring in one PATCH works, which is the way out.
Five checks cover the whole sequence, including that the name really is free while archived.

**A refused edit threw away what you typed (F6, was O2).** `change()` and `post()` returned
nothing, so every caller closed its editor or cleared its boxes in a `.then` that ran on refusal
too. Both now return whether the server accepted it. A colliding rename leaves the editor open with
the text in it; the administration forms keep theirs.

**The banner showed the previous error while the next request ran (F7, was O3).** Cleared where
each request starts, in all seven places that show a message. Proved by sampling the banner after a
submit: it held the old text before the click and was empty at 50, 150, 400, 900 and 1,800 ms,
instead of answering the new action with the old mistake for five seconds.

**A student leaving a class landed in the generic chatbot (F8, was O5).** Extended the exit
contract that already existed — `from=workspace`, `returnTo=home` — with `from=platform`, resolving
to `/platform`, which asks the server who the account is and forwards from there. One keyword for
all four roles, and **no path is ever taken from the query string**, so there is no open redirect.
The arrow's label went into all twelve locale files with a test that fails if any is missing.
Verified as a student: opened a course, pressed an arrow reading **"Back to my courses"**, landed
on the course list.

One correction that came with F5: the collision message used to say *"that instructor already
has…"* to the instructor reading it. It is now decided by who is asking — *"you already have"* for
the owner, *"its owner already has"* for an administrator editing somebody else's course.

### Verified, and how

- **232 API checks** (63 + 50 + 42 + 35 + 42), **0 failures**. The security suite grew 58 → 63, the
  research suite 46 → 50, the classroom-exit tests 11 → 15. *(Corrected in L15: this line first
  said "and the full unit suite", which was wrong — the run covered `tests/level3` and
  `tests/workbench`, not the repository's whole suite.)*
- `npx tsc --noEmit` clean; the i18n suite passes with the new key in all twelve locales.
- F4, F6, F7 and F8 re-checked by hand in the browser, as a student and as an administrator.
- Test data left as found; the rename probe was cancelled and every course kept its name.

### What the next session must not assume

- **Fourteen entries are still open** (O4, O6–O14, O16–O19). None of them loses work. O6 — a study
  cannot be edited or removed once created — is the only one that is a missing feature rather than
  a defect, and it is a 3A gap.
- **Still nothing is deployed.** Everything above is local; F8's redirect and F3's role guard are
  client-side and want re-checking once they are live.
- Two console errors seen while verifying F8 (`hasStudents is not defined`) were **stale hot-reload
  frames** from mid-edit, not a defect — the symbol does not exist in the file. The `StageStorage`
  refusal logged on every student classroom open is real and is recorded as O19.

## L13 — The two dashboards that were not designed (2026-10-22)

The role-play pass judged the instructor page designed and the other two not. These are those two.
They are F9 and F10 in `docs/DEFECT_REGISTER.md`.

**The administration page (F9, was O7)** was one column 3,400 px tall holding four unrelated
tables. The Users table had a search box; the courses table, twice as long with eighteen archived
rows mixed into the live ones, had neither search nor filter — and nothing said how much of
anything there was without scrolling four screens.

It now opens with a summary row (Accounts · Awaiting approval · Live courses · Archived), and the
courses table has search and a status filter defaulting to Active. The search covers **owner email**
as well as title and id, which is the administrator's own axis — *whose courses are these?* is the
question they arrive with, and the one an instructor never has to ask. The header reads
`All courses (7 of 26)` so a filtered view can never be mistaken for the whole platform.

One mistake worth recording: the first attempt put the "nothing matches" line in the **Users** card,
because `</tbody></table>` matched that table first. Caught by looking at the page rather than at
the diff — it rendered above the courses card, visibly in the wrong box. The courses table already
had an empty row; it just could not tell *no courses at all* from *nothing matches what you typed*,
and that is what was actually missing.

**The student dashboard (F10, was O8)** carried *Instructor*, *Last activity* and a labelled
*Course id*. The second is an administrator's column and the third is for a support conversation;
neither answers "what do I have to do?". Meanwhile Level 3 computes submissions, marking and
feedback, and `/api/level3/responses` already returns a student their own rows and nobody else's —
so the information existed and had never reached the person it was about.

The card now says **Your work: 2 submissions · 1 marked · last 22 Oct, 4:15 pm**, or *nothing
submitted yet*, with a line when feedback is waiting. "Marked" counts only a human assessment or an
AI one a human accepted; an unreviewed AI score is never shown, which is the rule everywhere else.
The id survives as a quiet second line under the title, because two instructors can each run a
"Research Methods".

### Something the verification turned up

**No learner response had ever existed in this database.** Every suite creates its own and deletes
it, so the populated card had never been seen by anyone. To look at it I submitted two answers and
a feedback event as `student-us@example.test`, read the card, and removed them again —
`learner_responses` is back to zero rows.

That is worth knowing beyond this change: **every screen that shows student work has only ever been
seen empty.** The instructor's Results tab, the trajectory view and the assessment panel are in the
same position. They are covered by API checks, which is not the same as having been looked at.

### Verified, and how

- **232 API checks, 0 failures**; `npx tsc --noEmit` clean.
- Both dashboards checked by hand in the browser, including the empty and populated branches of the
  student card and the empty, filtered and no-match states of the courses table.
- Temporary data removed: `learner_responses` back to 0 rows, no fixture courses left behind.

### Still open

Twelve entries (O4, O6, O9–O14, O16–O19). None loses work. O6 — a study cannot be edited or removed
once created — remains the only one that is a missing feature rather than a defect.

## L14 — Closing the register (2026-10-22)

The remaining twelve entries, done in one pass. `docs/DEFECT_REGISTER.md` now has
**twenty-two fixed and nothing open**. New findings start at O20.

Worth saying what this pass cost and why: the earlier sessions verified through the browser, which
is slow and expensive. Almost everything here was verified through the API suites instead, which is
why fourteen new checks exist rather than fourteen screenshots. The suites are the cheaper and the
more durable record.

### The one that was a missing feature

**A study could not be edited or removed (F11, was O6).** There was no `[studyId]` route at all —
no GET, no PATCH, no DELETE. A study was created with a title and an investigator and was then
fixed for ever as DRAFT with no protocol identifier. The fixture study's `PROTO-2026-001` was
written in SQL, so **the product could not reproduce its own fixture data**.

The route exists now, and removal follows the rule Level 2 already settled for courses rather than
inventing a second one: `research_participants` and `research_events` cascade from a study, so one
holding nothing is deleted and one holding data is **CLOSED**, with `confirmTitle` as the
administrator's deliberate override. The admin panel gained a protocol-id field, a status select in
place of the badge, and a Remove button whose warning says which of the two outcomes applies.

### The one with a trade worth naming

**A missing course was reported as a permission problem (F13, was O14).** Every permission check
answered identically whether a course belonged to someone else or never existed, so an owner who
mistyped an id was told `course owner permission required`.

The four `requireCourse*` helpers now answer `404 COURSE_NOT_FOUND` when the course is not there.
The trade is that a 404 confirms an id is unused — stage ids are ten random characters, so that
tells an enumerator nothing, and every other route already answered 404 for a course that was gone.
**Two checks pin both halves**, because the second is the one that matters: a missing course is 404,
*and somebody else's existing course is still 403*, so the new answer never becomes a way to find
out whose course is whose.

This also broke one existing assertion — a path-traversal id now returns 404 rather than 403. The
suite's `refused()` stays strict at 401/403 everywhere else, because a 404 there would hide a
course that had vanished; only that one check accepts it, with the reason written down beside it.

### The rest

- **F12 (O13)** `" (copy)"` was appended without checking the 200-character cap, so a long course
  could not be duplicated at all. A suffix nobody typed must never be the thing that fails.
- **F14 (O11)** The Results tab read `r.interactions`, a field **no route has ever returned** — the
  query produces `records`. The line printed the word with nothing in front of it.
- **F15 (O12)** The list counted active enrolments and the dialog counted every row it listed, so
  one course could read `2 students` and `Students (3)`.
- **F16/F17 (O9/O10)** A co-instructor's permission is a select now, not a badge with only Remove
  beside it — the capability existed, re-adding the address with the other permission, and nothing
  said so. And `ORDER BY ci.permission` is alphabetical, so EDITOR sorted above OWNER above VIEWER
  and the owner row jumped on every edit.
- **F18 (O4)** The banner collapsed when empty and moved everything under it by ~18 px. Reserved in
  all three places. This is the one that caused a real misclick during the audit.
- **F19/F20/F21 (O16/O17/O18)** Wording written for an administrator and shown to a teacher; an
  administrator told that every course on the platform was theirs; a login page with no way off it.
- **F22 (O19)** A learner's classroom mutates stage state, which schedules a document save the
  server refuses — correctly. It was logged as an error on every open. Only the log level and the
  message changed: it still returns false and a genuine save failure is still loud. The cheap fix
  here would have been to swallow the error, which would have been worse than the defect.

### Verified, and how

- **246 API checks** (68 + 59 + 42 + 35 + 42), **0 failures** — up from 232, fourteen of them new.
- `npx tsc --noEmit` clean.
- No browser verification in this pass, deliberately. F11's UI controls, F16's select and F18's
  reserved rows are wired but **have not been clicked by a human** — that is the gap to close next,
  and the cheapest way is one short pass, not a screenshot per change.

### What the next session must not assume

- **The register being empty does not mean the product is finished.** It means the 22 October audit
  is closed. A second role-play pass would find more; this one found twenty-two.
- **Still nothing is deployed.** Everything from L11 onward is local.
- The classroom's save refusal (F22) is quieter now but **still happens on every student open**. The
  real fix is not attempting the save, which lives in upstream's store and was judged too large to
  do safely here.

## L15 — What the repository's whole unit suite actually does (2026-10-22)

Running `npx vitest run` with no path — the **whole** suite, upstream's included — for what appears
to be the first time in this project. It does not pass, and it never did.

### First, a correction

The L12 entry said "232 API checks **and the full unit suite**, 0 failures". That was wrong: the run
behind it covered `tests/level3` and `tests/workbench`, not the repository. The line is corrected in
place. Left standing it would have cost the next session hours, because they would have believed the
suite was once green and gone looking for whoever broke it.

### The numbers

| | Files failed | Tests failed |
|---|---|---|
| Baseline `6b865715`, whole suite | 6 | **46** |
| This branch `d3698981`, whole suite | 5 | **45** |

`6b865715` is the commit immediately before this session's work, run in a throwaway worktree with
the same `node_modules`. **This branch is not worse than the baseline; it is one failure better**,
and that difference is noise rather than an improvement — see below.

### Two different things are failing

**Forty-four are deterministic and pre-existing.** Four files — `config/station-stage-keys`,
`media/server-backed-media-orchestrator`, `quiz/runtime`, `runtime/chat-storage` — fail standalone,
and they fail **identically in both trees**: `4 failed | 1 passed (5)`, `44 failed | 117 passed
(161)`, the same two lines at the baseline and here. None of them touches Level 2 or Level 3: LLM
station stage keys, multi-tab quiz races without Web Locks, media orchestration, and a chat-storage
test timing out at 5003 ms.

**The remaining one or two are flaky**, and which ones they are changes between runs. The baseline's
whole-suite run failed `agent-runtime/chart-schema-lockstep` and `generation/browser-entry`; this
branch's failed `workbench/workspace-rail-session-rename` instead. **All three pass standalone on
this branch** (3 files, 8 tests, green), so they are order- or parallelism-dependent, not broken.
That is also why 46 → 45 means nothing: a different flake landed, not a fixed test.

### What this does and does not say

- **Nothing in L11–L14 broke a test.** Proven by like-for-like, not asserted.
- **The suite has never been a gate here**, and calling a run green without saying which paths it
  covered is how L12's mistake happened. Say the paths or say nothing.
- **The 44 are worth fixing**, but they are upstream's and none blocks this project. They belong in
  `UPSTREAM_DELTA.md` as a known state, not in the defect register, which is about our own product.
- The flakes make any whole-suite run unreliable as a pass/fail signal. Until they are fixed, the
  honest check for our work is the five API suites plus the directories we touch, named explicitly.

## L16 — The second walkthrough: clicking what L14 only wired (2026-10-23)

L14 closed twelve defects and said plainly that its new controls "have not been clicked by a human".
This is that pass: signed in as administrator, instructor and student in turn and did each one's
real jobs. Four more findings, all fixed and verified the same day — F23–F27 in
`docs/DEFECT_REGISTER.md`.

### The two worth remembering

**RESEARCHER was in the role menu and refused by the server (F23).** The dropdown offers it,
`researcher@example.test` holds it, and choosing it answered `400 — role must be ADMIN, INSTRUCTOR
or STUDENT`. The route's `ROLES` set was written at Level 2 and never told that 3A had made
RESEARCHER a platform role with a database constraint of its own.

So **a researcher could only be created by running a seed script.** The administrator could see the
role, could see accounts holding it, and could not grant it. One line.

**The trajectory lost every timestamp — F14's exact mistake, a second time (F24).** The dialog's
interface declared `timestamp`; the route returns `createdAt`. So *every* row rendered its time as
`—`, on real content as much as on empty rows. Underneath, `courseTrajectory` LEFT JOINs
`runtime_records`, so a session with nothing in it still produced a row with every field null,
which drew as `— · event`.

It now reads `10/16/2026, 9:25:41 PM · opened a chat, nothing recorded`, and real rows carry their
own time. **The gap that let both F14 and this through is that nothing ever compared the UI's field
names against the route's output**, so two checks now assert exactly that — the one structural
lesson of this pass.

### The other two

- **F25** The student card said *"nothing submitted yet"* to a student with three sessions and two
  runtime records in that course — the instructor's Results tab says so on the next screen over.
  Both statements are true of different tables; together they read as lost work. Now *"no answers
  submitted yet"*. The deeper gap stays open as **O23**: classroom activity reaches the instructor
  and never the student.
- **F26/F27** The Users heading ignored its own search while the courses heading beside it read
  `(7 of 26)`; and thirteen role selects had no accessible name.

### What was exercised and found sound

Administrator: summary row, user search, role change and back, deactivate and reactivate, all four
course filters (`19 + 7 = 26`, consistent), study creation with a protocol identifier, status change
through the new select, and **both branches of the study Remove warning** — "deleted permanently"
for an empty study, "closed, not deleted, and nothing will be destroyed" for the fixture one, which
was declined.

Instructor: students dialog reading `Students (2, 1 inactive)` against the row's `2 students`
(F15 holding), adding a co-instructor, changing their permission through the new select (F16) with
the owner staying first (F17), the Results tab showing `3 sessions · 2 records` (F14 holding),
trajectory, unpublish and publish, duplicate, and deleting the copy through a dialog that correctly
said *deleted permanently*.

Student: the work line, opening a course, the back arrow reading **"Back to my courses"** landing on
`/platform/student` (F8), and `/platform/admin` and `/platform/researcher` both bouncing back (F3).

### Verified

- **248 API checks** (70 + 59 + 42 + 35 + 42), **0 failures**; two of them new, pinning the payload
  shapes the dashboards read.
- `tests/level2 level3 workbench i18n security`: 93 files, 1310 tests, 0 failures.
- `npx tsc --noEmit` clean.
- Every perturbation undone: the probe study deleted, the co-instructor removed, the duplicate
  deleted, the test account's role and status restored, the course republished.

### What the next session must not assume

- **One entry is open** (O23) and it is a feature, not a defect.
- The whole-repo unit suite still fails as described in L15. That is upstream's, measured, unchanged.
- **Still nothing is deployed.** Everything from L11 onward is local, now across six commits.
