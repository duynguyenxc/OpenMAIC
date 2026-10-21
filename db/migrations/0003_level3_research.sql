-- ============================================================================
-- Level 3A — institutions, templates, studies, participants, events, audit.
--
-- Built on top of Level 2, never over it: nothing here alters a Level-2 table
-- except to add nullable columns, so every Level-2 guarantee and every one of
-- its 58 checks still holds with this applied.
--
-- The rule that shapes all of it: course-level authorization stays
-- authoritative. Instruction v3 is explicit — "Do not infer permissions solely
-- from institution membership." Institutions describe *who belongs where*, for
-- grouping and for cross-institution studies. They never grant access to a
-- course. That stays with course_instructors and enrollments.
-- ============================================================================

-- ─── Institutions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS institutions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  short_name       text NOT NULL,
  country          text,
  institution_type text,
  status           text NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS institutions_short_name_unique
    ON institutions (lower(short_name));

-- A primary affiliation, nullable because Level-2 accounts predate this and
-- must keep working untouched.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS primary_institution_id uuid REFERENCES institutions (id) ON DELETE SET NULL;

-- Further affiliations, so a visiting researcher or a joint appointment can be
-- represented later without another migration.
CREATE TABLE IF NOT EXISTS institution_memberships (
  institution_id uuid NOT NULL REFERENCES institutions (id)  ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  role           text NOT NULL DEFAULT 'MEMBER',
  status         text NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, user_id)
);

CREATE INDEX IF NOT EXISTS institution_memberships_user ON institution_memberships (user_id);

-- ─── Templates ──────────────────────────────────────────────────────────────
-- The point of Level 3: different instructors run the *same* instructional
-- design while their classes and learner data stay apart.

CREATE TABLE IF NOT EXISTS course_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  description      text,
  source_course_id uuid REFERENCES courses (id) ON DELETE SET NULL,
  -- The OpenMAIC document the template publishes from. Kept by id, not copied,
  -- for the same reason courses are: OpenMAIC owns its own storage.
  source_stage_id  text NOT NULL,
  version          text NOT NULL DEFAULT '1.0',
  created_by       uuid NOT NULL REFERENCES user_profiles (id) ON DELETE RESTRICT,
  institution_id   uuid REFERENCES institutions (id) ON DELETE SET NULL,
  visibility       text NOT NULL DEFAULT 'PRIVATE'
                     CHECK (visibility IN ('PRIVATE', 'INSTITUTION', 'COMMUNITY', 'ADMIN_ONLY')),
  status           text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  discipline       text,
  tags             text[],
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- A template and version together name one instructional design, and research
-- reproducibility depends on that pair being stable.
CREATE UNIQUE INDEX IF NOT EXISTS course_templates_title_version_unique
    ON course_templates (created_by, lower(title), version);
CREATE INDEX IF NOT EXISTS course_templates_visibility ON course_templates (visibility, status);

-- Which template a course came from, and which version of it. Both nullable:
-- a course made directly in the workspace has no template, and that is normal.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS template_id      uuid REFERENCES course_templates (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_version text,
  ADD COLUMN IF NOT EXISTS institution_id   uuid REFERENCES institutions (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cloned_at        timestamptz,
  -- What the course was configured with at the moment it was cloned. The
  -- instruction's question — "WHAT EXACTLY DID THIS STUDENT EXPERIENCE?" —
  -- cannot be answered from current settings, because settings change.
  ADD COLUMN IF NOT EXISTS configuration_snapshot jsonb;

CREATE INDEX IF NOT EXISTS courses_template ON courses (template_id);
CREATE INDEX IF NOT EXISTS courses_institution ON courses (institution_id);

-- ─── Studies ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS studies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 text NOT NULL,
  description           text,
  principal_investigator uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
  protocol_identifier   text,
  status                text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
  start_date            date,
  end_date              date,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Which courses are in a study, and under which condition. Condition labels
-- are free text on purpose: the instruction says "Do not hard-code these
-- specific conditions. Allow researchers to define condition labels."
CREATE TABLE IF NOT EXISTS study_courses (
  study_id               uuid NOT NULL REFERENCES studies (id)  ON DELETE CASCADE,
  course_id              uuid NOT NULL REFERENCES courses (id)  ON DELETE CASCADE,
  experimental_condition text,
  cohort_label           text,
  added_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (study_id, course_id)
);

-- Who may see a study's data. Deliberately separate from course permission: a
-- researcher reading de-identified data is not a teacher, and must not become
-- one by being added here.
CREATE TABLE IF NOT EXISTS study_researchers (
  study_id   uuid NOT NULL REFERENCES studies (id)        ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES user_profiles (id)  ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'RESEARCHER'
               CHECK (role IN ('RESEARCHER', 'DATA_MANAGER', 'OBSERVER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (study_id, user_id)
);

-- ─── Participants ───────────────────────────────────────────────────────────
-- "Do not use student names/emails as research identifiers." The link between
-- a person and their participant id lives here and nowhere else, so an export
-- can carry P-00031 while this table stays behind an authorization check.

CREATE TABLE IF NOT EXISTS research_participants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id       uuid NOT NULL REFERENCES studies (id)       ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  participant_id text NOT NULL,
  -- Instructional access and research inclusion are separate things: a student
  -- may use the platform without being in anybody's dataset.
  consent_status text NOT NULL DEFAULT 'NOT_REQUESTED'
                   CHECK (consent_status IN
                     ('NOT_REQUESTED', 'PENDING', 'CONSENTED', 'DECLINED', 'WITHDRAWN')),
  consent_recorded_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, user_id),
  UNIQUE (study_id, participant_id)
);

-- ─── Research events ────────────────────────────────────────────────────────
-- A normalized layer *referencing* OpenMAIC's runtime records rather than
-- copying them. `source_runtime_record_id` is the join back; the payload here
-- holds only what an analyst needs to read a row without loading the original.

CREATE TABLE IF NOT EXISTS research_events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id                 uuid REFERENCES studies (id) ON DELETE SET NULL,
  course_id                uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  learner_id               uuid NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  session_id               text,
  activity_id              text,
  event_type               text NOT NULL,
  source_runtime_record_id text,
  event_timestamp          timestamptz NOT NULL,
  sequence_number          bigint,
  structured_payload       jsonb,
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- Projection is idempotent: running it twice must not double-count an event,
-- which a research dataset cannot survive.
--
-- Not a partial index, though the predicate would read better: PostgreSQL can
-- only infer ON CONFLICT from a partial index when the statement repeats its
-- predicate, and a plain unique index already allows many NULLs because NULLs
-- are distinct from each other. The simpler index is the one that works.
CREATE UNIQUE INDEX IF NOT EXISTS research_events_source_unique
    ON research_events (source_runtime_record_id);
CREATE INDEX IF NOT EXISTS research_events_course_time ON research_events (course_id, event_timestamp);
CREATE INDEX IF NOT EXISTS research_events_learner ON research_events (learner_id);
CREATE INDEX IF NOT EXISTS research_events_study ON research_events (study_id);

-- ─── Audit log ──────────────────────────────────────────────────────────────
-- Append-only by convention and by permission: nothing in the application
-- updates or deletes a row here.

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
  actor_email text,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action ON audit_log (action, created_at DESC);

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Same posture as Level 2: enabled with no policies, and the anon and
-- authenticated roles revoked, so nothing reaches these tables except the
-- server's own connection. The fence is the API; this is the wall behind it.

ALTER TABLE institutions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE studies                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_courses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_researchers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_participants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log               ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON institutions, institution_memberships, course_templates, studies,
              study_courses, study_researchers, research_participants,
              research_events, audit_log
  FROM anon, authenticated;

-- ─── One new role, not four ─────────────────────────────────────────────────
-- Instruction v3 offers RESEARCHER, DATA_MANAGER and OBSERVER and immediately
-- warns: "Do NOT create excessive roles." Only RESEARCHER earns a platform
-- role in 3A, because only it needs a dashboard of its own. The other two are
-- degrees of access *within a study*, and live in study_researchers.role,
-- where they cost nothing until something uses them.

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('ADMIN', 'INSTRUCTOR', 'STUDENT', 'RESEARCHER'));
