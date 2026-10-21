-- ============================================================================
-- Level 3B — rubrics, AI assessment, human review, adaptive feedback,
-- and response revisions.
--
-- Additive, like 3A: nothing here alters a table Levels 1, 2 or 3A depend on.
--
-- One rule shapes the whole file: **an AI score and a human score are
-- different things and neither may overwrite the other.** The instruction is
-- unambiguous — "Do NOT overwrite instructor/human ratings. Maintain AI_SCORE,
-- HUMAN_SCORE, FINAL_SCORE as separate fields." So an assessment row records
-- who or what produced it, a review row records what a human decided about an
-- AI one, and the final score is derived from the review rather than written
-- over anything.
-- ============================================================================

-- ─── Rubrics ────────────────────────────────────────────────────────────────
-- Versioned, because "Store rubric version used for each assessment" is
-- impossible if a rubric can be edited under a finished assessment.

CREATE TABLE IF NOT EXISTS rubrics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  version     text NOT NULL DEFAULT '1.0',
  description text,
  created_by  uuid NOT NULL REFERENCES user_profiles (id) ON DELETE RESTRICT,
  status      text NOT NULL DEFAULT 'DRAFT'
                CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- A title at a version is one rubric, for one author, for ever.
CREATE UNIQUE INDEX IF NOT EXISTS rubrics_title_version_unique
    ON rubrics (created_by, lower(title), version);

CREATE TABLE IF NOT EXISTS rubric_dimensions (
  rubric_id    uuid NOT NULL REFERENCES rubrics (id) ON DELETE CASCADE,
  dimension_id text NOT NULL,
  name         text NOT NULL,
  description  text,
  max_score    integer NOT NULL DEFAULT 4 CHECK (max_score > 0),
  ordering     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (rubric_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS rubric_levels (
  rubric_id    uuid NOT NULL,
  dimension_id text NOT NULL,
  score        integer NOT NULL,
  descriptor   text NOT NULL,
  PRIMARY KEY (rubric_id, dimension_id, score),
  FOREIGN KEY (rubric_id, dimension_id)
    REFERENCES rubric_dimensions (rubric_id, dimension_id) ON DELETE CASCADE
);

-- ─── Attaching a rubric, and setting a feedback policy ──────────────────────
-- Per course and activity, because the same module run under two conditions
-- is the whole point of Level 3: same rubric, different feedback policy.

CREATE TABLE IF NOT EXISTS rubric_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       uuid NOT NULL REFERENCES courses (id)  ON DELETE CASCADE,
  activity_id     text NOT NULL,
  rubric_id       uuid NOT NULL REFERENCES rubrics (id)  ON DELETE RESTRICT,
  rubric_version  text NOT NULL,
  -- The five the instruction names, and no more.
  feedback_policy text NOT NULL DEFAULT 'ON_REQUEST'
                    CHECK (feedback_policy IN
                      ('OFF', 'ON', 'AFTER_FIRST_RESPONSE', 'AFTER_SUBMISSION', 'ON_REQUEST')),
  created_by      uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, activity_id)
);

-- ─── Learner responses, and their revisions ─────────────────────────────────
-- "Store each version independently. Do not overwrite previous attempts."
-- A revision is a new row whose parent is the attempt it revises, so the chain
-- Initial → Feedback → Revision 1 → Feedback → Revision 2 is readable in both
-- directions and nothing is lost.

CREATE TABLE IF NOT EXISTS learner_responses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id         uuid NOT NULL REFERENCES courses (id)        ON DELETE CASCADE,
  learner_id        uuid NOT NULL REFERENCES user_profiles (id)  ON DELETE CASCADE,
  activity_id       text NOT NULL,
  attempt_number    integer NOT NULL DEFAULT 1,
  parent_attempt_id uuid REFERENCES learner_responses (id) ON DELETE SET NULL,
  -- "Always preserve: original response, processed/transcribed response,
  -- processing metadata. Do not discard original student input." Typed text is
  -- its own original; handwriting and audio (3D) will fill the other two.
  response_type     text NOT NULL DEFAULT 'TYPED_TEXT'
                      CHECK (response_type IN ('TYPED_TEXT', 'HANDWRITTEN_IMAGE', 'AUDIO_RESPONSE')),
  original_input    text,
  response_text     text NOT NULL,
  processing_metadata jsonb,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, learner_id, activity_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS learner_responses_course_activity
    ON learner_responses (course_id, activity_id);
CREATE INDEX IF NOT EXISTS learner_responses_learner ON learner_responses (learner_id);

-- ─── Assessments ────────────────────────────────────────────────────────────
-- One row per act of assessing. `assessor_kind` is what keeps AI and human
-- apart; neither updates the other's row, ever.

CREATE TABLE IF NOT EXISTS assessments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id    uuid NOT NULL REFERENCES learner_responses (id) ON DELETE CASCADE,
  rubric_id      uuid NOT NULL REFERENCES rubrics (id) ON DELETE RESTRICT,
  rubric_version text NOT NULL,
  assessor_kind  text NOT NULL CHECK (assessor_kind IN ('AI', 'HUMAN')),
  assessor_id    uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
  -- The provenance the instruction lists, per assessment rather than per
  -- course: "Store: model used; prompt version; rubric version; timestamp;
  -- raw model result; parsed score; human override if any."
  model          text,
  prompt_version text,
  raw_result     jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assessments_response ON assessments (response_id, assessor_kind);

CREATE TABLE IF NOT EXISTS assessment_scores (
  assessment_id uuid NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
  dimension_id  text NOT NULL,
  score         numeric NOT NULL,
  evidence      text,
  confidence    numeric,
  PRIMARY KEY (assessment_id, dimension_id)
);

-- ─── Human review of an AI assessment ───────────────────────────────────────
-- "Store: AI recommendation, human decision, final decision, timestamp,
-- reviewer ID. This is important for later AI-vs-human comparison." Which is
-- why the review points at both assessments rather than replacing one.

CREATE TABLE IF NOT EXISTS assessment_reviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id        uuid NOT NULL REFERENCES learner_responses (id) ON DELETE CASCADE,
  ai_assessment_id   uuid REFERENCES assessments (id) ON DELETE SET NULL,
  human_assessment_id uuid REFERENCES assessments (id) ON DELETE SET NULL,
  decision           text NOT NULL CHECK (decision IN ('ACCEPTED', 'REVISED', 'REJECTED')),
  reviewer_id        uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
  feedback           text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assessment_reviews_response ON assessment_reviews (response_id);

-- ─── Feedback ───────────────────────────────────────────────────────────────
-- "Record all generated feedback." Every piece, whether a learner saw it or
-- not, with the policy that allowed it and the model that produced it.

CREATE TABLE IF NOT EXISTS feedback_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id    uuid NOT NULL REFERENCES learner_responses (id) ON DELETE CASCADE,
  kind           text NOT NULL
                   CHECK (kind IN ('HINT', 'SOCRATIC_QUESTION', 'MISCONCEPTION_PROMPT',
                                   'REQUEST_FOR_EXPLANATION', 'EXAMPLE', 'REVIEW_SUGGESTION')),
  content        text NOT NULL,
  policy         text NOT NULL,
  model          text,
  prompt_version text,
  shown_at       timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_events_response ON feedback_events (response_id);

-- ─── Row-level security ─────────────────────────────────────────────────────
ALTER TABLE rubrics             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubric_dimensions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubric_levels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubric_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_responses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_scores   ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_reviews  ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_events     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON rubrics, rubric_dimensions, rubric_levels, rubric_assignments,
              learner_responses, assessments, assessment_scores,
              assessment_reviews, feedback_events
  FROM anon, authenticated;
