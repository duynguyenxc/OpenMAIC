-- ============================================================================
-- Level 3 — retention policy.
--
--   "Make retention configurable. Administrator should be able to specify:
--    instructional data retention; research data retention; deleted-account
--    handling; de-identification strategy."
--   "Do not permanently delete records automatically without explicit policy."
--
-- The second sentence is why this table holds a *policy* and why nothing in
-- the platform deletes on a timer. A retention period here states intent and
-- lets an administrator see exactly what it would cover; carrying it out is a
-- deliberate act, not a cron job that quietly destroys a study's data one
-- night.
-- ============================================================================

CREATE TABLE IF NOT EXISTS retention_policy (
  -- One row. The constraint is the singleton.
  id                        boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- NULL means "keep indefinitely", which is the default and the safe one.
  instructional_days        integer CHECK (instructional_days IS NULL OR instructional_days > 0),
  research_days             integer CHECK (research_days IS NULL OR research_days > 0),
  deleted_account_handling  text NOT NULL DEFAULT 'RETAIN_DEIDENTIFIED'
                              CHECK (deleted_account_handling IN
                                ('RETAIN_DEIDENTIFIED', 'RETAIN_IDENTIFIED', 'PURGE_ON_REQUEST')),
  deidentification_strategy text NOT NULL DEFAULT 'PARTICIPANT_ID_ONLY'
                              CHECK (deidentification_strategy IN
                                ('PARTICIPANT_ID_ONLY', 'HASH_IDENTIFIERS', 'FULL_ANONYMISE')),
  notes                     text,
  updated_by                uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

INSERT INTO retention_policy (id, notes)
VALUES (true, 'Default: keep everything. A period is set deliberately, and nothing acts on it automatically.')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE retention_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON retention_policy FROM anon, authenticated;
