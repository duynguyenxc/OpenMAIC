/**
 * Level 3 — research export, and the data-quality report that goes with it.
 *
 * Three rules shape this file, all of them from the instruction:
 *
 * 1. **"Research exports should normally use participant_id, not name, email."**
 *    Nothing here selects an email or a display name. The link between a person
 *    and P-00031 lives in `research_participants` and stays behind an
 *    authorization check.
 * 2. **"Research exports must allow exclusion of participants not authorized
 *    for research use."** The filter is consent, not enrolment. A student uses
 *    the platform for their course; being in a dataset is a separate decision,
 *    and the default here excludes anyone who has not made it.
 * 3. **"Generate a data-quality report for research exports."** An export that
 *    says nothing about its own gaps invites someone to analyse a hole. The
 *    report is computed from the same rows that are exported, not from a
 *    separate pass that could disagree with them.
 */
import { level2Pool } from '@/lib/level2/db';
import { EXPORTABLE_CONSENT } from './participants';

export interface ExportRow {
  study_id: string;
  study_title: string;
  course_id: string;
  course_title: string;
  institution: string | null;
  experimental_condition: string | null;
  cohort_label: string | null;
  participant_id: string;
  consent_status: string;
  session_id: string | null;
  activity_id: string | null;
  event_type: string;
  event_timestamp: string;
  sequence_number: number | null;
  payload_kind: string | null;
  payload_role: string | null;
  characters: number | null;
  excerpt: string | null;
  template_title: string | null;
  template_version: string | null;
  source_runtime_record_id: string | null;
}

export interface QualityReport {
  rows: number;
  participants: number;
  courses: number;
  checks: Array<{ check: string; failures: number; detail?: string }>;
  excluded: { participantsWithoutConsent: number; eventsWithoutParticipant: number };
}

export async function exportStudy(
  studyId: string,
  options: { includeAllConsentStates?: boolean } = {},
): Promise<{ rows: ExportRow[]; quality: QualityReport }> {
  const pool = await level2Pool();
  const consentStates = options.includeAllConsentStates
    ? ['NOT_REQUESTED', 'PENDING', 'CONSENTED', 'DECLINED', 'WITHDRAWN']
    : EXPORTABLE_CONSENT;

  const { rows } = await pool.query(
    `SELECT s.id::text          AS study_id,
            s.title             AS study_title,
            c.openmaic_stage_id AS course_id,
            c.title             AS course_title,
            i.short_name        AS institution,
            sc.experimental_condition,
            sc.cohort_label,
            rp.participant_id,
            rp.consent_status,
            e.session_id,
            e.activity_id,
            e.event_type,
            to_char(e.event_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS event_timestamp,
            e.sequence_number,
            e.structured_payload->>'kind'       AS payload_kind,
            e.structured_payload->>'role'       AS payload_role,
            (e.structured_payload->>'characters')::int AS characters,
            e.structured_payload->>'excerpt'    AS excerpt,
            t.title             AS template_title,
            c.template_version,
            e.source_runtime_record_id
       FROM research_events e
       JOIN courses c   ON c.id = e.course_id
       JOIN studies s   ON s.id = $1
       JOIN study_courses sc ON sc.study_id = s.id AND sc.course_id = c.id
       -- An event with no consenting participant is not exported at all; the
       -- join is the filter, and the count of what it dropped is reported.
       JOIN research_participants rp
         ON rp.study_id = s.id AND rp.user_id = e.learner_id
        AND rp.consent_status = ANY($2::text[])
       LEFT JOIN institutions i      ON i.id = c.institution_id
       LEFT JOIN course_templates t  ON t.id = c.template_id
      WHERE e.study_id = $1
      ORDER BY rp.participant_id, e.event_timestamp, e.sequence_number`,
    [studyId, consentStates],
  );

  const exported = rows as ExportRow[];

  // ── Data quality, computed over the study rather than over the export, so
  //    it can report what the export is missing as well as what it contains.
  const { rows: counts } = await pool.query(
    `SELECT
       (SELECT count(*) FROM research_events WHERE study_id = $1)                        AS events,
       (SELECT count(*) FROM research_events e
          LEFT JOIN research_participants rp
            ON rp.study_id = $1 AND rp.user_id = e.learner_id
         WHERE e.study_id = $1 AND rp.id IS NULL)                                        AS no_participant,
       (SELECT count(*) FROM research_participants
         WHERE study_id = $1 AND consent_status <> 'CONSENTED')                          AS no_consent,
       (SELECT count(*) FROM research_events
         WHERE study_id = $1 AND event_timestamp > now() + interval '1 day')             AS future_timestamps,
       (SELECT count(*) FROM research_events
         WHERE study_id = $1 AND source_runtime_record_id IS NULL)                       AS orphan_events,
       (SELECT count(*) FROM study_courses sc JOIN courses c ON c.id = sc.course_id
         WHERE sc.study_id = $1 AND sc.experimental_condition IS NULL)                   AS courses_without_condition,
       (SELECT count(*) FROM study_courses sc JOIN courses c ON c.id = sc.course_id
         WHERE sc.study_id = $1 AND c.configuration_snapshot IS NULL)                    AS courses_without_snapshot`,
    [studyId],
  );
  const c = counts[0] as Record<string, string>;

  const quality: QualityReport = {
    rows: exported.length,
    participants: new Set(exported.map((r) => r.participant_id)).size,
    courses: new Set(exported.map((r) => r.course_id)).size,
    checks: [
      {
        check: 'events with no research participant record',
        failures: Number(c.no_participant),
        detail:
          'a learner produced events in a study course but was never registered as a participant',
      },
      {
        check: 'events dated in the future',
        failures: Number(c.future_timestamps),
        detail: 'an impossible timestamp usually means a clock or an import problem',
      },
      {
        check: 'events not traceable to a runtime record',
        failures: Number(c.orphan_events),
        detail: 'every event should name the OpenMAIC record it was derived from',
      },
      {
        check: 'study courses with no experimental condition',
        failures: Number(c.courses_without_condition),
        detail: 'a course in a study without a condition label cannot be analysed as a condition',
      },
      {
        check: 'study courses with no configuration snapshot',
        failures: Number(c.courses_without_snapshot),
        detail: 'without it, what the student actually experienced cannot be reconstructed later',
      },
    ],
    excluded: {
      participantsWithoutConsent: Number(c.no_consent),
      eventsWithoutParticipant: Number(c.no_participant),
    },
  };

  return { rows: exported, quality };
}

/** RFC 4180 quoting: a transcript is full of commas, quotes and newlines. */
export function toCsv(rows: ExportRow[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map((r) =>
      headers.map((h) => cell((r as unknown as Record<string, unknown>)[h])).join(','),
    ),
  ].join('\n');
}
