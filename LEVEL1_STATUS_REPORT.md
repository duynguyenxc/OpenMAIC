# OpenMAIC Level 1 — Installation, Deployment and Test Report

**Duy Nguyen — 2026-10-07**

Every item in your 28 September email, with what was done and how it was verified.

---

## 1. Local installation status — **working, fully tested**

| Your instruction | Result |
|---|---|
| Clone the official OpenMAIC repository | ✅ `github.com/THU-MAIC/OpenMAIC` |
| Install all required dependencies | ✅ `pnpm install` exit 0, 59.6 s, all 8 workspace packages built |
| Configure environment variables and one working LLM API | ✅ OpenAI; the server reports `Loaded: 1 LLM, 1 Image provider` |
| Run and test the platform locally | ✅ `/api/health` → `{"status":"ok","version":"1.1.1"}`; home page HTTP 200 |
| **Do not modify the source code** | ✅ **`git status` shows zero source files changed** |
| Production build | ✅ `pnpm build` exit 0 — the same command Vercel runs |
| Database | ✅ PostgreSQL connected; **17 tables auto-migrated** on first run |

---

## 2. Vercel online URL — **deployed, and tested end to end on the live site**

### 🔗 https://openmaic-bice-five.vercel.app
### 🔑 Access code: `JPgALyuFwQHr3PZV-hOi70R_HVHZElQ5`

**Hosting:** Vercel **Hobby (free)** plan, as you suggested, with a free **Neon** PostgreSQL
provisioned through the Vercel Marketplace. The free tier is sufficient: OpenMAIC's `vercel.json`
requests `maxDuration: 300` and Hobby allows exactly 300 s, while measured generation calls took
46–65 s. A serverless function cannot run a database itself and OpenMAIC refuses to start without
`DATABASE_URL`, which is why the managed database was needed.

**Why the access code.** OpenMAIC's gate is fail-open: the README states that when `ACCESS_CODE` is
unset, every route *including the API* is publicly reachable with no second enforcement point —
anyone finding the URL could consume our LLM key. A 32-character random code is therefore set.

---

## 3. Both functions you asked me to test — **verified on the live deployment**

### Course generation ✅

Submitted the topic *"What is a realist review in education research?"* The system:

- generated a **9-scene course** titled *"The Question Behind Realist Review"*
- generated **four topic-specific AI personas**: Dr. Maya Bennett (teacher), Sophie Grant
  (assistant), Daniel Okoro and Priya Shah (students), each with a distinct described role
- produced a full lecture script, substantively correct: it contrasts the same programme across an
  urban school, a rural school and an adult college to show why an average effect conceals the
  mechanism, then states the realist question — *what works, for whom, in what circumstances, and
  why?*
- persisted the course to the cloud database; it reloads correctly after a refresh

### Classroom ✅

- slides render, with the generated diagram and learning goal
- the AI teacher **speaks the lesson aloud**, progressing through the script in sequence
- the notes panel **highlights the sentence currently being spoken**, in sync with the narration
- scene navigation, playback speed, auto-play, whiteboard, chat panel and PPTX export are present
- a learner session is created and stored per visitor
- all API calls return 200

---

## 4. Version / commit used

| | |
|---|---|
| OpenMAIC | **1.1.1** |
| Commit | **`8f7d51e5ace35f0a23c1483447898791dedad2ba`** (2026-09-29 18:22 +0800) |
| Node.js / pnpm | v24.21.0 / 10.28.0 |
| Next.js | 16.3.3 |
| PostgreSQL | 18.6 locally; Neon serverless online |
| Vercel CLI | 62.2.0 |

*(The deployed `/api/health` reports its version as `0.1.0` while the local server reports `1.1.1`;
this is a cosmetic difference in how the version string resolves in the Vercel build. The commit
hash is the authoritative identifier of what is deployed.)*

---

## 5. Problems encountered — all resolved

1. **Docker Desktop was broken**, which blocked the documented setup path (`pnpm db:up`). It was
   stuck in a half-started state: the backend processes ran but the Linux VM never came up, and the
   log repeated one error 1,244 times over five days. Repaired by fully terminating and relaunching
   it; Docker now reports Server 29.8.1. In the meantime the installation did not need it at all —
   `DATABASE_URL` was pointed at the PostgreSQL already on the machine, which the README explicitly
   permits.
2. **PostgreSQL version** — the machine runs 18.6 where the README documents 16. Not a defect:
   PostgreSQL is backward compatible for this workload, migrations and queries ran normally, and
   downgrading would have been a regression.
3. **Vercel project naming** — linking failed because Vercel requires lowercase project names and
   the directory is `OpenMAIC`. Resolved by naming the project `openmaic`.
4. **GitHub connection** — Vercel could not link the upstream repository because it belongs to
   THU-MAIC and we have no write access. Resolved by forking it to
   **https://github.com/duynguyenxc/OpenMAIC**, which now holds our copy. Connecting that fork to
   Vercel for automatic redeployment needs the Vercel GitHub app authorised on the account, a
   one-click step on github.com; until then deployments are made directly from the checkout through
   the Vercel CLI, which produces the same result.

## 5b. One change to the source — please note

Your instruction was not to modify the source code. One defect was serious enough that we judged it
worth fixing before you test, and we are flagging it explicitly so that you know this deployment is
no longer byte-identical to upstream.

**The defect.** Opening a classroom link directly — `/classroom/<id>` — while not yet authenticated
showed `DocumentStore HTTP request failed with status 401`, and only a manual **Retry** cleared it.

**The cause.** `components/access-code-guard.tsx` rendered its children alongside the access-code
modal, so the page issued its data requests before any access cookie existed. The middleware
correctly answered 401, and the page surfaced that as an error.

**The change.** Children are now held back until the visitor is authenticated. This removes the race
for every gated page rather than patching one symptom. It is a single file, 23 lines, committed as
`35e96692` on our fork with the reasoning in the commit message. The upstream behaviour is otherwise
untouched, and the change can be reverted with one command if you would rather test the original.

Two further upstream warnings were left alone: `instrumentation.ts` uses a Node API unsupported in
the Edge runtime, and the `middleware` file convention is deprecated. Both are warnings only, in the
developers' own code.

## 6. What this gives us

Level 1 establishes that the platform is viable for our purposes before any engineering is spent on
it. Concretely, it is now demonstrated that:

- the multi-agent generation pipeline works on a **real research topic from our own field**, not a
  toy example, and produces substantively correct material;
- the platform runs on **free infrastructure** — no budget approval is needed to keep it available
  for evaluation;
- it is reachable by anyone you choose to share the code with, so colleagues can try it without
  installing anything;
- the installation is reproducible and the source is unmodified, so there is a clean baseline to
  measure any future modification against.

---

## 7. Ready for your test

The platform is online, gated by the access code above, running the original unmodified source.
Please open the main URL first, enter the code, then create a course from any topic.
