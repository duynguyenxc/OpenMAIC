-- ============================================================================
-- Level 3D — multi-modal responses, job queue, LMS boundary, usage accounting.
--
-- Three instructions shape this file:
--
--   "Do NOT implement every modality inside the OpenMAIC core. Use processing
--    services."
--   "Always preserve: original response, processed/transcribed response,
--    processing metadata. Do not discard original student input."
--   "Some Level-3 tasks may be computationally expensive ... Design these as
--    jobs/queues where appropriate. Do not block interactive student classroom
--    operation with long-running research jobs."
--
-- And one restraint: "Do NOT make Canvas integration mandatory for Level 3.
-- Create an integration boundary for future LMS support." So what is built
-- here is the boundary, not Canvas.
-- ============================================================================

-- ─── The original student input, kept ───────────────────────────────────────
-- A transcription is a derived artefact. If the recording is thrown away, a
-- disputed transcription cannot be checked and a research claim about what a
-- student said rests on nothing. So the bytes are kept beside the text.

CREATE TABLE IF NOT EXISTS response_media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id   uuid REFERENCES learner_responses (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('HANDWRITTEN_IMAGE', 'AUDIO_RESPONSE')),
  content_type  text NOT NULL,
  byte_size     integer NOT NULL,
  -- Prototype storage. A production deployment moves this to object storage
  -- and keeps a URI here; nothing above this table would change.
  bytes         bytea NOT NULL,
  original_name text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS response_media_response ON response_media (response_id);

-- ─── Jobs ───────────────────────────────────────────────────────────────────
-- Transcription, handwriting extraction and bulk scoring are slow and must not
-- sit in a student's request. A row here is a promise to do work later; the
-- student's submission returns immediately with the job's id.

CREATE TABLE IF NOT EXISTS processing_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL
                 CHECK (kind IN ('TRANSCRIBE_AUDIO', 'EXTRACT_HANDWRITING',
                                 'ASSESS_RESPONSE', 'PROJECT_STUDY')),
  status       text NOT NULL DEFAULT 'QUEUED'
                 CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
  payload      jsonb NOT NULL,
  result       jsonb,
  error        text,
  attempts     integer NOT NULL DEFAULT 0,
  response_id  uuid REFERENCES learner_responses (id) ON DELETE CASCADE,
  media_id     uuid REFERENCES response_media (id) ON DELETE CASCADE,
  created_by   uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

CREATE INDEX IF NOT EXISTS processing_jobs_queue ON processing_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS processing_jobs_response ON processing_jobs (response_id);

-- ─── Usage accounting ───────────────────────────────────────────────────────
-- "Add usage monitoring. Track where technically possible: model; request
-- count; token/input usage; token/output usage; estimated cost. Aggregate by
-- course; instructor; study; institution."
--
-- Recorded per call rather than per course, so every aggregate the instruction
-- asks for is a GROUP BY rather than a second accounting system. Token counts
-- are nullable because a provider that does not report them must leave the
-- column empty rather than have a number invented for it.

CREATE TABLE IF NOT EXISTS model_usage (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage          text NOT NULL,
  model          text,
  purpose        text,
  input_tokens   integer,
  output_tokens  integer,
  estimated_cost numeric(12, 6),
  course_id      uuid REFERENCES courses (id)        ON DELETE SET NULL,
  study_id       uuid REFERENCES studies (id)        ON DELETE SET NULL,
  institution_id uuid REFERENCES institutions (id)   ON DELETE SET NULL,
  actor_id       uuid REFERENCES user_profiles (id)  ON DELETE SET NULL,
  response_id    uuid REFERENCES learner_responses (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS model_usage_course ON model_usage (course_id, created_at);
CREATE INDEX IF NOT EXISTS model_usage_study  ON model_usage (study_id, created_at);

-- ─── LMS boundary ───────────────────────────────────────────────────────────
-- Not Canvas. A boundary that a Canvas, Moodle or Blackboard adapter can be
-- written against, and which the platform works perfectly without — the
-- instruction is explicit that the core must stay independently usable.

CREATE TABLE IF NOT EXISTS lms_integrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  -- No provider is privileged. 'MANUAL' is a real provider: an export a human
  -- carries into an LMS, which is how most pilots actually work.
  provider      text NOT NULL DEFAULT 'MANUAL',
  -- LTI 1.3 shaped, because that is what the instruction names. Null until a
  -- real adapter needs them.
  issuer        text,
  client_id     text,
  deployment_id text,
  status        text NOT NULL DEFAULT 'INACTIVE'
                  CHECK (status IN ('ACTIVE', 'INACTIVE')),
  config        jsonb,
  created_by    uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lms_course_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES lms_integrations (id) ON DELETE CASCADE,
  course_id      uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  lms_course_id  text NOT NULL,
  lms_context_label text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, course_id)
);

-- A grade leaving the platform is an outward-facing act and is recorded as one.
CREATE TABLE IF NOT EXISTS lms_grade_postings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES lms_integrations (id) ON DELETE CASCADE,
  response_id    uuid NOT NULL REFERENCES learner_responses (id) ON DELETE CASCADE,
  line_item      text,
  score          numeric,
  max_score      numeric,
  status         text NOT NULL DEFAULT 'PREPARED'
                   CHECK (status IN ('PREPARED', 'SENT', 'FAILED')),
  detail         jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lms_grade_postings_response ON lms_grade_postings (response_id);

-- ─── Row-level security ─────────────────────────────────────────────────────
ALTER TABLE response_media     ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_usage        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_integrations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_course_links   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_grade_postings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON response_media, processing_jobs, model_usage,
              lms_integrations, lms_course_links, lms_grade_postings
  FROM anon, authenticated;
