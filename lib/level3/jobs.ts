/**
 * Level 3D — the job queue.
 *
 * *"Some Level-3 tasks may be computationally expensive: transcription;
 * handwriting processing; bulk rubric scoring; research export generation; KG
 * indexing. Design these as jobs/queues where appropriate. Do not block
 * interactive student classroom operation with long-running research jobs."*
 *
 * A student uploading a recording gets an answer immediately: the bytes are
 * stored, a job is queued, and the response exists with empty text until the
 * transcription lands. Nothing waits on a provider that might take thirty
 * seconds.
 *
 * Deliberately a **database queue**, not Redis or a hosted broker. The work is
 * minutes-scale and low-volume, the database is already there, and a row is
 * visible to anyone debugging. `claimNext` takes a row under
 * `FOR UPDATE SKIP LOCKED`, so two workers never take the same job — which is
 * the only hard part of a queue this size, and it is one clause.
 */
import { level2Pool } from '@/lib/level2/db';

export type JobKind =
  | 'TRANSCRIBE_AUDIO'
  | 'EXTRACT_HANDWRITING'
  | 'ASSESS_RESPONSE'
  | 'PROJECT_STUDY';

export interface Job {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  responseId: string | null;
  mediaId: string | null;
  attempts: number;
}

/** A promise to do work later. Returns immediately. */
export async function enqueue(input: {
  kind: JobKind;
  payload: Record<string, unknown>;
  responseId?: string | null;
  mediaId?: string | null;
  createdBy?: string | null;
}): Promise<string> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `INSERT INTO processing_jobs (kind, payload, response_id, media_id, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      input.kind,
      input.payload,
      input.responseId ?? null,
      input.mediaId ?? null,
      input.createdBy ?? null,
    ],
  );
  return (rows[0] as { id: string }).id;
}

/**
 * Take the oldest queued job, atomically.
 *
 * `SKIP LOCKED` is what makes two workers safe: a row another transaction is
 * holding is passed over rather than waited for.
 */
export async function claimNext(): Promise<Job | null> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `UPDATE processing_jobs
        SET status = 'RUNNING', started_at = now(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM processing_jobs
         WHERE status = 'QUEUED'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id, kind, payload, response_id AS "responseId", media_id AS "mediaId", attempts`,
  );
  return (rows[0] as Job | undefined) ?? null;
}

export async function finish(
  jobId: string,
  outcome: { ok: boolean; result?: unknown; error?: string },
): Promise<void> {
  const pool = await level2Pool();
  await pool.query(
    `UPDATE processing_jobs
        SET status = $2, result = $3, error = $4, finished_at = now()
      WHERE id = $1`,
    [jobId, outcome.ok ? 'DONE' : 'FAILED', outcome.result ?? null, outcome.error ?? null],
  );
}

/**
 * Put a failed job back, up to a limit.
 *
 * Three attempts, because a transcription provider that is down for a minute
 * should not lose a student's recording, and one that is misconfigured should
 * not be retried for ever. The original bytes are kept either way, so a job
 * that exhausts its attempts can be requeued by hand without the student
 * resubmitting.
 */
export async function requeueIfRetryable(
  job: Job,
  error: string,
  maxAttempts = 3,
): Promise<boolean> {
  if (job.attempts >= maxAttempts) {
    await finish(job.id, { ok: false, error: `${error} (gave up after ${job.attempts} attempts)` });
    return false;
  }
  const pool = await level2Pool();
  await pool.query(
    `UPDATE processing_jobs SET status = 'QUEUED', error = $2, started_at = NULL WHERE id = $1`,
    [job.id, error],
  );
  return true;
}

export async function queueDepth(): Promise<Record<string, number>> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `SELECT status, count(*)::int n FROM processing_jobs GROUP BY status`,
  );
  return Object.fromEntries(
    (rows as Array<{ status: string; n: number }>).map((r) => [r.status, r.n]),
  );
}
