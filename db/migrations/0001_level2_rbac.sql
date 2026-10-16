-- Level 2 — identity, course authorization and enrolment.
--
-- These tables live beside OpenMAIC's own tables in `public`, in the same
-- database, so that the `onCreate` persistence hook can write a course row
-- inside the transaction OpenMAIC uses to create the course. See
-- docs/LEVEL2_ARCHITECTURE_AUDIT.md section 9.
--
-- Deliberately NO foreign key references OpenMAIC's tables. OpenMAIC runs its
-- own migrations at start-up and owns its schema; a hard FK would couple our
-- migration order to theirs and break on an upstream change. The link to a
-- course document is a soft reference, `courses.openmaic_stage_id` ->
-- `stage_meta.stage_id`, kept unique here and reconciled by the application.

BEGIN;

CREATE TABLE IF NOT EXISTS user_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Supabase auth.users.id. Unique: one profile per account.
  auth_user_id        uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  email               text NOT NULL,
  display_name        text,
  role                text NOT NULL DEFAULT 'STUDENT'
                        CHECK (role IN ('ADMIN', 'INSTRUCTOR', 'STUDENT')),
  -- The institutional/study identifier (JSU-00123, STUDY-P001). NOT the email,
  -- and NOT yet the research participant id, which Level 3 introduces.
  external_identifier text,
  -- Level 2 keeps the institution as a label. Level 3 replaces it with an
  -- institutions table and institution_memberships; this column is the
  -- migration source for that step.
  institution         text,
  status              text NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('ACTIVE', 'INACTIVE', 'PENDING')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_email_lower_key
  ON user_profiles (lower(email));
CREATE INDEX IF NOT EXISTS user_profiles_role_status_idx
  ON user_profiles (role, status);

COMMENT ON TABLE  user_profiles IS
  'Level 2: one row per authenticated account. Role and status are authoritative and may be changed only by an ADMIN, server-side.';
COMMENT ON COLUMN user_profiles.external_identifier IS
  'Institutional or study identifier. Never the email. Level 3 adds a separate research participant id.';

CREATE TABLE IF NOT EXISTS courses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Soft reference to OpenMAIC's stage_meta.stage_id. The course content
  -- itself stays in OpenMAIC's tables and is never duplicated here.
  openmaic_stage_id    text NOT NULL UNIQUE,
  title                text NOT NULL,
  owner_instructor_id  uuid NOT NULL REFERENCES user_profiles (id) ON DELETE RESTRICT,
  status               text NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS courses_owner_idx  ON courses (owner_instructor_id);
CREATE INDEX IF NOT EXISTS courses_status_idx ON courses (status);

COMMENT ON TABLE courses IS
  'Level 2: application metadata for an OpenMAIC course. Content lives in OpenMAIC''s document tables; this row carries ownership and publication state.';

CREATE TABLE IF NOT EXISTS course_instructors (
  course_id     uuid NOT NULL REFERENCES courses (id)       ON DELETE CASCADE,
  instructor_id uuid NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  permission    text NOT NULL CHECK (permission IN ('OWNER', 'EDITOR', 'VIEWER')),
  added_by      uuid          REFERENCES user_profiles (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, instructor_id)
);

CREATE INDEX IF NOT EXISTS course_instructors_instructor_idx
  ON course_instructors (instructor_id);

-- Exactly one OWNER per course. A co-instructor is EDITOR or VIEWER.
CREATE UNIQUE INDEX IF NOT EXISTS course_instructors_one_owner
  ON course_instructors (course_id) WHERE permission = 'OWNER';

COMMENT ON TABLE course_instructors IS
  'Level 2: which instructors may act on a course, and how. Exactly one OWNER per course, enforced by a partial unique index.';

CREATE TABLE IF NOT EXISTS enrollments (
  course_id   uuid NOT NULL REFERENCES courses (id)       ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE', 'INACTIVE', 'COMPLETED')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  enrolled_by uuid          REFERENCES user_profiles (id) ON DELETE SET NULL,
  PRIMARY KEY (course_id, student_id)
);

CREATE INDEX IF NOT EXISTS enrollments_student_idx ON enrollments (student_id, status);

COMMENT ON TABLE enrollments IS
  'Level 2: a student may open a course only with an ACTIVE row here and a PUBLISHED course.';

-- updated_at maintenance
CREATE OR REPLACE FUNCTION level2_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_profiles_touch ON user_profiles;
CREATE TRIGGER user_profiles_touch BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION level2_touch_updated_at();

DROP TRIGGER IF EXISTS courses_touch ON courses;
CREATE TRIGGER courses_touch BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION level2_touch_updated_at();

-- Row-level security.
--
-- The application reaches these tables over a direct Postgres connection, not
-- through PostgREST, so RLS does not govern our own queries. It is enabled
-- anyway, with no policy granted to `anon` or `authenticated`, so that a
-- client holding the Supabase publishable key cannot read or write them
-- through the auto-generated API. Authorization stays server-side, in the
-- application; this is a second fence, not the fence.
ALTER TABLE user_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON user_profiles, courses, course_instructors, enrollments
  FROM anon, authenticated;

COMMIT;
