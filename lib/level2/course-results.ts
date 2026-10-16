/**
 * Level 2 — reading learner interaction out of OpenMAIC's runtime store.
 *
 * Nothing is recorded by us. The audit (section 5) established that
 * `runtime_sessions` and `runtime_records` already carry course, learner,
 * activity kind, scene and an ordered sequence, and the instruction forbids a
 * competing table system. These queries only join that data to accounts,
 * which is possible because the learner key *is* the owner id
 * (`user:<auth_user_id>`).
 */
import { level2Pool } from './db';

export interface StudentSummary {
  email: string;
  displayName: string | null;
  externalIdentifier: string | null;
  enrollmentStatus: string;
  sessions: number;
  records: number;
  lastActivityAt: string | null;
  kinds: string[];
}

export async function courseResults(stageId: string): Promise<StudentSummary[]> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `SELECT up.email,
            up.display_name        AS "displayName",
            up.external_identifier AS "externalIdentifier",
            e.status               AS "enrollmentStatus",
            COALESCE(r.sessions, 0)::int AS sessions,
            COALESCE(r.records, 0)::int  AS records,
            r.last_activity_at     AS "lastActivityAt",
            COALESCE(r.kinds, ARRAY[]::text[]) AS kinds
       FROM enrollments e
       JOIN courses c        ON c.id = e.course_id
       JOIN user_profiles up ON up.id = e.student_id
       LEFT JOIN LATERAL (
         SELECT count(DISTINCT s.id)            AS sessions,
                count(rec.id)                   AS records,
                max(GREATEST(s.updated_at, rec.created_at)) AS last_activity_at,
                array_agg(DISTINCT s.kind)      AS kinds
           FROM runtime_sessions s
           LEFT JOIN runtime_records rec ON rec.session_id = s.id
          WHERE s.stage_id = c.openmaic_stage_id
            AND s.learner_key = 'user:' || up.auth_user_id
       ) r ON true
      WHERE c.openmaic_stage_id = $1
      ORDER BY up.email`,
    [stageId],
  );
  return rows as unknown as StudentSummary[];
}

export interface TrajectoryRow {
  email: string;
  studentInternalId: string;
  externalIdentifier: string | null;
  sessionKind: string;
  /** `payload.kind`, e.g. chat_message or chat_session_state. */
  activityType: string | null;
  /** `payload.sceneId` when the record carries one, else the record's scene. */
  activityId: string | null;
  /** `payload.content` when `payload.role` is 'user'. */
  learnerInput: string | null;
  /** `payload.content` when `payload.role` is 'assistant'. */
  agentResponse: string | null;
  seq: number | null;
  createdAt: string | null;
  payload: unknown;
}

/**
 * The chronological trajectory the instruction asks an instructor to be able
 * to inspect. `email` is optional: without it the whole course is returned,
 * which is what the export uses.
 */
export async function courseTrajectory(stageId: string, email?: string): Promise<TrajectoryRow[]> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `SELECT up.email,
            up.id                  AS "studentInternalId",
            up.external_identifier AS "externalIdentifier",
            s.kind                 AS "sessionKind",
            rec.data::jsonb -> 'payload' ->> 'kind'    AS "activityType",
            COALESCE(rec.data::jsonb -> 'payload' ->> 'sceneId', rec.scene_id) AS "activityId",
            CASE WHEN rec.data::jsonb -> 'payload' ->> 'role' = 'user'
                 THEN rec.data::jsonb -> 'payload' ->> 'content' END AS "learnerInput",
            CASE WHEN rec.data::jsonb -> 'payload' ->> 'role' = 'assistant'
                 THEN rec.data::jsonb -> 'payload' ->> 'content' END AS "agentResponse",
            rec.seq,
            rec.created_at         AS "createdAt",
            rec.data               AS payload
       FROM runtime_sessions s
       JOIN courses c        ON c.openmaic_stage_id = s.stage_id
       JOIN user_profiles up ON 'user:' || up.auth_user_id = s.learner_key
       JOIN enrollments e    ON e.course_id = c.id AND e.student_id = up.id
       LEFT JOIN runtime_records rec ON rec.session_id = s.id
      WHERE c.openmaic_stage_id = $1
        AND ($2::text IS NULL OR lower(up.email) = lower($2))
      ORDER BY up.email, s.created_at, rec.seq`,
    [stageId, email ?? null],
  );
  return rows as unknown as TrajectoryRow[];
}
