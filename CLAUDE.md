@AGENTS.md

# CLAUDE.md — OpenMAIC, as extended for Prof. Wei Zheng

## Read this first
1. **`WALKTHROUGH.md`** — what happened, session by session, and what is still open. Start here.
2. **`docs/LEVEL2_PROGRESS.md`** — the professor's 22-item instruction, ticked item by item,
   including the two items that are **not** claimed.
3. Then only the file you actually need; `WALKTHROUGH.md` has a table saying which.

Do not read the whole repository to orient yourself. That is what these two files are for.

## What this is
Tsinghua's Open Multi-Agent Interactive Classroom, forked and extended in levels for Prof. Wei
Zheng. Level 1 = the platform as published, deployed. Level 2 = accounts, three roles
(ADMIN / INSTRUCTOR / STUDENT), and server-enforced isolation — **done**, live at
`openmaic-level2.vercel.app`. Level 3 (`instruction v3`) = **not started**.

**This is not the realist evidence synthesis project.** That one lives in
`~/Downloads/Realist-Evidence-Synthesis-V2` and is unrelated. Nothing is shared between them.

## Standing rules
- **Write a `WALKTHROUGH.md` entry at the end of every session.** Detailed enough that the next
  session does not have to re-read the repository or re-derive a decision. Say what was verified
  and *how*; say what was found and left unfixed. This is not optional, and it is not a summary of
  the commit messages.
- **Keep the upstream delta small and recorded.** `origin` stays pointed at `THU-MAIC/OpenMAIC` so
  upstream remains pullable. Every change to a file OpenMAIC maintains goes in
  `docs/UPSTREAM_DELTA.md` with its reason. Prefer a new file of ours over editing one of theirs.
- **Push to our fork explicitly**, never by repointing `origin`:
  `git push https://github.com/duynguyenxc/OpenMAIC.git HEAD:feature/level2-rbac`
- **Level 1 is a separate Vercel project. Do not touch it.**
- **Verify, then claim.** A requirement is ticked when it has been measured, and marked ⚠️ when it
  has not. `docs/LEVEL2_PROGRESS.md` items 14 and 19 are the worked examples of this.
- **All project files, code and identifiers in English.** Vietnamese is for chat only.

## Credentials
`.env.local` holds the Supabase keys, the database URL and the OpenAI key.
`.env.level2-test-accounts` holds the six test accounts' passwords. Both are gitignored.
Re-seed with `node scripts/level2-seed-test-accounts.mjs`.
