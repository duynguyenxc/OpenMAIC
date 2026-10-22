/**
 * Level 3D — the worker.
 *
 * A route rather than a daemon, because this deployment is serverless and a
 * long-lived process has nowhere to live. It drains a bounded number of jobs
 * and returns; a scheduler, a cron, or an instructor pressing a button calls
 * it. The queue is durable either way, so nothing is lost between calls.
 *
 * `GET` reports the depth without doing work, which is what a dashboard wants.
 */
import { requireAuthenticatedUser } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { claimNext, finish, queueDepth, requeueIfRetryable } from '@/lib/level3/jobs';
import { processorFor, type MediaKind } from '@/lib/level3/media';
import { recordUsage } from '@/lib/level3/usage';
import { json, withOwner, apiError } from '@/lib/level2/route-helpers';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);
    if (actor.role === 'STUDENT') {
      return apiError(403, 'FORBIDDEN', 'the job queue is not visible to students', headers);
    }
    return json({ depth: await queueDepth() }, 200, headers);
  });
}

export function POST(req: Request): Promise<Response> {
  return withRequestOwner(req, async (principal, headers) => {
    try {
      const actor = await requireAuthenticatedUser(principal.ownerId);
      if (actor.role === 'STUDENT') {
        return apiError(403, 'FORBIDDEN', 'students cannot run the job queue', headers);
      }
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const max = Math.min(Number(body.max) || 5, 20);

      const pool = await level2Pool();
      const processed: Array<Record<string, unknown>> = [];

      for (let i = 0; i < max; i += 1) {
        const job = await claimNext();
        if (!job) break;

        try {
          if (job.kind === 'TRANSCRIBE_AUDIO' || job.kind === 'EXTRACT_HANDWRITING') {
            const { rows } = await pool.query(
              `SELECT kind, content_type AS "contentType", bytes FROM response_media WHERE id = $1`,
              [job.mediaId],
            );
            const media = rows[0] as { kind: MediaKind; contentType: string; bytes: Buffer } | undefined;
            if (!media) throw new Error('the uploaded file is gone');

            // Handwriting needs a vision model; transcription uses OpenMAIC's
            // own ASR configuration and needs none from here.
            let model: unknown = null, modelString = '', serverManaged = false;
            if (media.kind === 'HANDWRITTEN_IMAGE') {
              const resolved = await resolveModelFromRequest(req as never, {}, 'level3-handwriting');
              model = resolved.model; modelString = resolved.modelString;
              serverManaged = resolved.serverManaged;
            }

            const outcome = await processorFor(media.kind).process({
              bytes: media.bytes, contentType: media.contentType,
              model, modelString, serverManaged,
            });

            // The original is never touched; only the derived text is written.
            await pool.query(
              `UPDATE learner_responses
                  SET response_text = $2,
                      processing_metadata = coalesce(processing_metadata, '{}'::jsonb)
                                            || $3::jsonb
                WHERE id = $1`,
              [job.responseId, outcome.text,
               { ...outcome.metadata, status: outcome.ok ? 'processed' : 'failed' }],
            );

            if (media.kind === 'HANDWRITTEN_IMAGE' && modelString) {
              await recordUsage({
                stage: 'level3-handwriting', model: modelString, purpose: 'handwriting',
                responseId: job.responseId, actorId: actor.profileId,
              });
            }

            if (!outcome.ok) {
              const retried = await requeueIfRetryable(job, String(outcome.metadata.error ?? 'extraction produced nothing'));
              processed.push({ jobId: job.id, kind: job.kind, ok: false, retried });
              continue;
            }
            await finish(job.id, { ok: true, result: { characters: outcome.text.length } });
            processed.push({ jobId: job.id, kind: job.kind, ok: true, characters: outcome.text.length });
          } else {
            // ASSESS_RESPONSE and PROJECT_STUDY are queued by other routes and
            // not yet drained here; leaving them queued is honest.
            await requeueIfRetryable(job, 'no worker for this job kind yet', 1);
            processed.push({ jobId: job.id, kind: job.kind, ok: false, reason: 'no worker' });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const retried = await requeueIfRetryable(job, message);
          processed.push({ jobId: job.id, kind: job.kind, ok: false, error: message, retried });
        }
      }

      return json({ processed, depth: await queueDepth() }, 200, headers);
    } catch (error) {
      const { AuthorizationError } = await import('@/lib/level2/authorization');
      if (error instanceof AuthorizationError) {
        return apiError(error.status, error.code, error.message, headers);
      }
      throw error;
    }
  });
}
