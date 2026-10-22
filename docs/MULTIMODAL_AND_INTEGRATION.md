# Multi-modal responses, jobs, LMS and analytics (Level 3D)

**Duy Nguyen · 22 October 2026**

## Handwriting and audio, as services

> *"Do NOT implement every modality inside the OpenMAIC core. Use processing services."*

Each modality is a `ResponseProcessor`: bytes in, normalized text out, with metadata saying how it
got there. Nothing in the classroom renderer changed.

| Modality | Processor | Behind it |
|---|---|---|
| `HANDWRITTEN_IMAGE` | `HandwritingProcessor` | a **vision model**, routed as `level3-handwriting` |
| `AUDIO_RESPONSE` | `AudioProcessor` | **OpenMAIC's own `transcribeAudio`** and its ASR configuration |

Audio reuses OpenMAIC's layer rather than adding a second transcription path — *"Reuse OpenMAIC
provider abstractions where possible"* — because a second path is a second thing to configure and a
second thing to be wrong.

Handwriting is deliberately **not** OCR-with-cleanup. The model is told to reproduce what is on the
page including mistakes, and to write `[illegible]` where a word cannot be read. A guessed word in a
student's answer becomes evidence in somebody's dataset; an honest `[illegible]` is worth more than
a confident invention. The metadata counts those markers.

## The original is never discarded

> *"Always preserve: original response, processed/transcribed response, processing metadata. Do not
> discard original student input."*

| What | Where |
|---|---|
| the recording or the page | `response_media.bytes` |
| the transcription or extraction | `learner_responses.response_text` |
| how it was produced | `learner_responses.processing_metadata` |

A transcription is a derived artefact. Throw the recording away and a disputed transcription cannot
be checked, and a claim about what a student said rests on nothing. A **failed** extraction leaves
the response with empty text, the metadata saying `failed`, and the bytes untouched — so the job
can be retried without the student resubmitting. A test asserts the original survives processing
whatever the outcome.

Storage is `bytea` for the prototype. A production deployment moves it to object storage and keeps
a URI; nothing above that table would change.

## The job queue

> *"Some Level-3 tasks may be computationally expensive ... Design these as jobs/queues where
> appropriate. Do not block interactive student classroom operation with long-running research
> jobs."*

A student uploading a recording gets `202` immediately: the bytes are stored, the response row
exists with empty text, and a job is queued. Nothing waits on a provider that might take thirty
seconds.

A **database queue**, not Redis. The work is minutes-scale and low-volume, the database is already
there, and a row is visible to anyone debugging. The only hard part is not handing one job to two
workers, and that is one clause — `FOR UPDATE SKIP LOCKED`.

The worker is a route (`POST /api/level3/jobs/run`), not a daemon, because this deployment is
serverless and a long-lived process has nowhere to live. It drains a bounded number and returns;
the queue is durable between calls. Three attempts, then the job is marked failed — a provider down
for a minute should not lose a recording, and one misconfigured should not be retried for ever.

## The LMS boundary

> *"Do NOT make Canvas integration mandatory for Level 3. Create an integration boundary for future
> LMS support ... Keep the core platform independently usable without Canvas."*

So what exists is the **boundary**. `LmsProvider` has the four capabilities LTI 1.3 implies —
verify, list courses, roster, post grade — and one implementation, `MANUAL`.

`MANUAL` is not a stub pretending to be an integration. It is how most pilots genuinely work: an
instructor exports grades and carries them into the LMS. It returns real data about *this*
platform, records a posting as `PREPARED` rather than `SENT`, and says in every response that
nothing was transmitted.

Asking for a provider that does not exist creates the integration **`INACTIVE`** and says so in
words, rather than looking configured and silently doing nothing. A Canvas adapter is
`LmsProvider` plus a registration; nothing above that interface imports Canvas, LTI or any vendor
name.

**One rule matters most at this boundary:** a grade leaving the platform must be a **final** score —
a human's, or an AI score a human accepted. An unreviewed AI score is refused with `409
NO_FINAL_SCORE`. It is the same rule as everywhere else, and this is where breaking it would reach
somebody's transcript.

## Usage accounting

> *"Track where technically possible: model; request count; token usage; estimated cost. Aggregate
> by course; instructor; study; institution."* and *"Do not block Level 3 solely because exact
> provider billing data are unavailable."*

One row per model call in `model_usage`, so every aggregate the instruction names is a `GROUP BY`
rather than a second ledger. Available by course, instructor, study, institution and model.

Two honesty measures:

- **Token counts are nullable and a missing one stays missing.** A provider that does not report
  usage leaves the column empty rather than having a number estimated into it and later mistaken
  for a measurement.
- **`knownTokens` is reported beside every total**, because a small cost can mean cheap models or a
  provider that reports nothing, and those are different facts.

Prices are a local table labelled as the operator's own figures; `estimated_cost` is named for
exactly that reason, and a model with no price yields `null` rather than a guess.

## Research analytics

Four questions, each answerable only because of a decision made in an earlier sublevel:

| Question | Possible because |
|---|---|
| Do the conditions differ? | every section carries a condition label and a configuration snapshot (3A) |
| How often did AI and human agree? | neither score ever overwrote the other (3B) |
| Did revision improve anything? | every attempt was kept rather than updated (3B) |
| What did it cost, and where? | usage is recorded per call (3D) |

Means are over **final** scores only. Agreement is computed only where both an AI and a human
assessment exist, and that count — `comparable` — is reported first, because an agreement rate over
three responses should look like it means nothing. Every figure reports its n, and the caveats are
returned **with** the numbers rather than in a footnote.

## What 3D does not do

- **No Canvas, no LTI launch, no roster sync over a network.** The boundary exists; no adapter does.
- **No OCR engine.** Handwriting goes to a vision model; a scanned PDF of many pages is not split.
- **Audio is limited by the configured ASR provider**, and if none is configured the job fails
  honestly and the recording is kept.
- **No scheduler.** The worker runs when something calls it.
- **No object storage.** Media lives in the database, which is fine for a pilot and not for a
  cohort.
