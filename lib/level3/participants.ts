/**
 * Level 3 — research participant identifiers.
 *
 * "Do not use student names/emails as research identifiers. Maintain
 * application_user_id separately from research_participant_id."
 *
 * So a participant id is allocated per study, not per person: the same student
 * in two studies is two participants, and neither dataset can be joined to the
 * other without the table that links them — which lives behind an
 * authorization check and never appears in an export.
 *
 * Consent is separate from enrolment on purpose. A student may use the
 * platform for their course without being in anybody's dataset, and the
 * exporter filters on this, not on the roll.
 */
import type { Queryable } from '@/lib/server/persistence-hooks';

export type ConsentStatus =
  | 'NOT_REQUESTED'
  | 'PENDING'
  | 'CONSENTED'
  | 'DECLINED'
  | 'WITHDRAWN';

/** Consent states whose data an export may contain. */
export const EXPORTABLE_CONSENT: ConsentStatus[] = ['CONSENTED'];

/**
 * The next free identifier in a study: P-00001, P-00002…
 *
 * Allocated under the study's advisory lock by the caller, so two learners
 * entering a study at the same moment cannot take the same number. The format
 * is padded so that identifiers sort the way a human expects in a spreadsheet.
 */
export async function nextParticipantId(db: Queryable, studyId: string): Promise<string> {
  const { rows } = await db.query(
    `SELECT participant_id FROM research_participants
      WHERE study_id = $1 AND participant_id ~ '^P-[0-9]+$'
      ORDER BY (substring(participant_id from 3))::int DESC
      LIMIT 1`,
    [studyId],
  );
  const highest = rows[0] as { participant_id?: string } | undefined;
  const next = highest ? Number(highest.participant_id!.slice(2)) + 1 : 1;
  return `P-${String(next).padStart(5, '0')}`;
}
