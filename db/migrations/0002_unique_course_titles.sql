-- Level 2, correction of 2026-10-21.
--
-- Nothing stopped an instructor owning two courses with the same name. On a
-- dashboard that is a real problem rather than an aesthetic one: the project
-- owner could not tell six courses called "Course A" apart, and neither could
-- anyone reading a results export.
--
-- Uniqueness is per OWNER, not global, and on purpose. Level 3 clones one
-- template into a section at each institution, and those sections are supposed
-- to carry the same name — they differ by owner, by course id and by roll.
-- Making the title globally unique would break that before it was built.
--
-- ARCHIVED courses are excluded: a name should become free again once the
-- course that held it has left the instructor's list, and an archived course
-- keeps its own name for the record.

CREATE UNIQUE INDEX IF NOT EXISTS courses_owner_title_unique
    ON courses (owner_instructor_id, lower(title))
 WHERE status <> 'ARCHIVED';
