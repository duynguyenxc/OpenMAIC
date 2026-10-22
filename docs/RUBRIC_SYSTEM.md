# Rubric and assessment system (Level 3B)

**Duy Nguyen · 21 October 2026**

## The rule everything else follows

> *"Do NOT overwrite instructor/human ratings. Maintain AI_SCORE, HUMAN_SCORE, FINAL_SCORE as
> separate fields when applicable."*

A system where the second rating replaces the first cannot answer how often the two agreed — which
is the question this platform exists to make answerable. So:

- an **assessment** is one act of judging, with `assessor_kind` of `AI` or `HUMAN`;
- a **review** records what a human decided *about* an AI assessment, and changes neither;
- the **final score is derived, never stored over anything**: the human's if there is one, the AI's
  if a human accepted it, and otherwise **none**. An unreviewed AI score is not a final score, and
  the interface says so in those words.

## Rubrics are versioned, and immutable once published

`rubrics` + `rubric_dimensions` + `rubric_levels`. A title at a version, for one author, is one
rubric for ever — `409 VERSION_EXISTS` refuses a second. To change a rubric you publish `1.1`.

This is not tidiness. *"Store rubric version used for each assessment"* is impossible if a rubric
can be edited under a finished assessment, and a study that re-scored its data halfway through
would have no comparable numbers.

Every assessment stores the `rubric_version` it used, copied rather than referenced.

## Attaching a rubric, and choosing when feedback happens

`rubric_assignments` ties a rubric to **one activity in one course**, with a feedback policy.

Per course and activity on purpose: the same module, run in two conditions, with the same rubric
and different feedback. That is a study design, and it needs no code to express.

| Policy | What it does |
|---|---|
| `OFF` | no feedback |
| `ON` | whenever asked for or generated |
| `AFTER_FIRST_RESPONSE` | only from the second attempt — the first answer stays a clean measurement |
| `AFTER_SUBMISSION` | only once submitted |
| `ON_REQUEST` | only when the student asks |

A refusal is a `409` with the reason in words, not an empty response.

## The assessment service

`lib/level3/assessment.ts`, called from `POST /api/level3/responses/<id>/assess`.

**Input** — the student response, the activity prompt, course context, an optional reference answer,
and the rubric. **Output** — a score per dimension with **evidence quoted from the student's own
words** and a confidence, plus up to three feedback suggestions.

Evidence is required because a score with no quotation is not reviewable: a human disagreeing needs
something specific to disagree with.

**Stored per assessment**, which is what makes a result reproducible later: model, prompt version
(`assess-v1`), rubric version, timestamp, the **raw model result**, and the parsed scores.

Two deliberate behaviours:

- **Out-of-range scores are clamped, not rejected**, and a dimension the model invented is dropped.
- **An unparseable reply is stored, not thrown away.** A model answering in prose is a fact about
  the model, and it belongs in the record rather than in an exception.

## Human review

`POST /api/level3/responses/<id>/review` with `ACCEPTED`, `REVISED` or `REJECTED`.

`REVISED` writes a **new** `HUMAN` assessment beside the AI one. `REJECTED` records that the AI's
answer was discarded and keeps it. In all three cases the AI's scores are still there afterwards,
and an automated test asserts exactly that by counting them before and after.

## Adaptive feedback

`lib/level3/feedback.ts`, a service beside the classroom and not inside it:
*"Do not hard-wire adaptive behavior inside the core OpenMAIC renderer."* Nothing in the teaching
path calls it, so a lesson runs identically whether it works, is switched off, or fails.

It steers on the **weakest rubric dimensions** of that particular answer, and is given the student's
earlier attempts and the feedback they have already received, with an instruction not to repeat it
— telling someone the same thing twice is where adaptive feedback stops being adaptive.

**Every generated piece is recorded**, shown or not, with the policy that allowed it and the model
that produced it. `shown_at` distinguishes feedback a learner saw from feedback that merely existed,
and the research layer emits `FEEDBACK_SHOWN` and `FEEDBACK_GENERATED` as different events.

## Response revisions

`learner_responses`, with `attempt_number` and `parent_attempt_id`.

> *"Support multiple attempts. Store each version independently. Do not overwrite previous
> attempts."*

A revision is a new row pointing at the attempt it revises. The chain
Initial → Feedback → Revision 1 → Feedback → Revision 2 is readable in both directions, and
measuring learning change — the reason to keep revisions at all — is a query rather than an
archaeology exercise.

Attempt numbers are allocated under an advisory lock per learner and activity, so two submissions at
once cannot collide.

`response_type` is `TYPED_TEXT` today. `original_input` and `processing_metadata` exist and are
filled with the typed text itself, which is honest: for typed answers the original *is* the
processed form. Handwriting and audio (3D) will put the upload in one and the transcription in the
other, and *"Do not discard original student input"* will hold without a schema change.

## Models

Two new stages, `level3-assessment` and `level3-feedback`, registered in OpenMAIC's own
`LLM_STAGES` so an operator can route and budget them separately from teaching:

```
MODEL_ROUTES='{"level3-assessment":{"model":"openai:gpt-4.1"},
               "level3-feedback":{"model":"openai:gpt-4.1-mini"}}'
```

This had to be configured: the classroom resolves its model from the browser, and a server-side
service has no browser. Which is as it should be — *"Administrator controls provider credentials"*,
and *"Do not expose API keys to instructors or students."*

## What 3B does not do

- **No automatic assessment.** An instructor presses the button. Assessment costs money and a study
  design decides when it happens.
- **No grade book, no weights, no totals.** Dimension scores only. Turning them into a grade is a
  decision about teaching that the platform should not make quietly.
- **Nothing is scored twice by the AI without being asked.** Each press writes a new assessment;
  none replaces another.
