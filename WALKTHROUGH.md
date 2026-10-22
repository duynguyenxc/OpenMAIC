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
