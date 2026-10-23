/**
 * Level 3D — submit handwriting or audio as a response.
 *
 * The student's request returns **immediately**: the bytes are stored, a
 * response row is created with empty text, and a job is queued. Nothing waits
 * on a transcription provider, because *"Do not block interactive student
 * classroom operation with long-running research jobs."*
 *
 * The original is kept whatever happens afterwards. A failed extraction leaves
 * a response with no text and a job that can be retried; it never loses what
 * the student actually submitted.
 */
import {
  requireAuthenticatedUser,
  requireCourseEnrollment,
  requireCourseInstructor,
} from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { enqueue } from '@/lib/level3/jobs';
import { ACCEPTED, MAX_UPLOAD_BYTES, type MediaKind } from '@/lib/level3/media';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function POST(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);

    const form = await req.formData().catch(() => null);
    if (!form)
      return apiError(400, 'FORM_REQUIRED', 'send the file as multipart/form-data', headers);

    const stageId = String(form.get('stageId') ?? '');
    const activityId = String(form.get('activityId') ?? '').trim();
    const kind = String(form.get('kind') ?? '') as MediaKind;
    const file = form.get('file');

    if (!stageId || !activityId) {
      return apiError(400, 'COURSE_REQUIRED', 'a course and an activity are required', headers);
    }
    if (kind !== 'HANDWRITTEN_IMAGE' && kind !== 'AUDIO_RESPONSE') {
      return apiError(
        400,
        'INVALID_KIND',
        'kind must be HANDWRITTEN_IMAGE or AUDIO_RESPONSE',
        headers,
      );
    }
    if (!(file instanceof File)) {
      return apiError(400, 'FILE_REQUIRED', 'a file is required', headers);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return apiError(
        413,
        'FILE_TOO_LARGE',
        `that file is ${(file.size / 1e6).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1e6} MB`,
        headers,
      );
    }
    const contentType = file.type || 'application/octet-stream';
    if (!ACCEPTED[kind].includes(contentType)) {
      // Said plainly rather than attempted and failed later: a format we
      // cannot read is refused at the door, with the list.
      return apiError(
        400,
        'UNSUPPORTED_TYPE',
        `${contentType} is not accepted for ${kind}; try ${ACCEPTED[kind].join(', ')}`,
        headers,
      );
    }

    if (actor.role === 'STUDENT') await requireCourseEnrollment(ownerId, stageId);
    else await requireCourseInstructor(ownerId, stageId);

    const pool = await level2Pool();
    const { rows: courseRows } = await pool.query(
      `SELECT id FROM courses WHERE openmaic_stage_id = $1`,
      [stageId],
    );
    const course = courseRows[0] as { id: string } | undefined;
    if (!course) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);

    const bytes = Buffer.from(await file.arrayBuffer());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `response:${course.id}:${actor.profileId}:${activityId}`,
      ]);

      const { rows: last } = await client.query(
        `SELECT id, attempt_number AS "attemptNumber" FROM learner_responses
          WHERE course_id = $1 AND learner_id = $2 AND activity_id = $3
          ORDER BY attempt_number DESC LIMIT 1`,
        [course.id, actor.profileId, activityId],
      );
      const previous = last[0] as { id: string; attemptNumber: number } | undefined;

      // The response exists before the text does. That is the point of the
      // queue: a student is not kept waiting for a provider.
      const { rows: created } = await client.query(
        `INSERT INTO learner_responses
           (course_id, learner_id, activity_id, attempt_number, parent_attempt_id,
            response_type, original_input, response_text, processing_metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'',$8)
         RETURNING id, attempt_number AS "attemptNumber"`,
        [
          course.id,
          actor.profileId,
          activityId,
          (previous?.attemptNumber ?? 0) + 1,
          previous?.id ?? null,
          kind,
          `${kind}: ${file.name || 'upload'}`,
          {
            source: kind,
            status: 'queued',
            originalName: file.name || null,
            contentType,
            byteSize: bytes.length,
            receivedAt: new Date().toISOString(),
          },
        ],
      );
      const response = created[0] as { id: string; attemptNumber: number };

      const { rows: media } = await client.query(
        `INSERT INTO response_media (response_id, kind, content_type, byte_size, bytes, original_name)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [response.id, kind, contentType, bytes.length, bytes, file.name || null],
      );
      await client.query('COMMIT');

      const jobId = await enqueue({
        kind: kind === 'AUDIO_RESPONSE' ? 'TRANSCRIBE_AUDIO' : 'EXTRACT_HANDWRITING',
        payload: { stageId, activityId },
        responseId: response.id,
        mediaId: (media[0] as { id: string }).id,
        createdBy: actor.profileId,
      });

      return json(
        {
          responseId: response.id,
          attemptNumber: response.attemptNumber,
          jobId,
          status: 'queued',
          message:
            kind === 'AUDIO_RESPONSE'
              ? 'Your recording was received. The transcription is being made; your recording is kept either way.'
              : 'Your page was received. It is being read; the original image is kept either way.',
        },
        202,
        headers,
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
