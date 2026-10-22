/**
 * Level 3D — the LMS boundary, as an API.
 *
 * Nothing here is Canvas. Creating an integration, linking a course and
 * preparing a grade all work; whether anything is **sent** depends on whether
 * an adapter exists, and the response says which happened rather than letting
 * anyone assume.
 */
import { requireCourseOwner } from '@/lib/level2/authorization';
import { requirePlatformAdmin } from '@/lib/level3/authorization';
import { level2Pool } from '@/lib/level2/db';
import { availableProviders, prepareGrade, providerFor } from '@/lib/level3/lms';
import { audit } from '@/lib/level3/audit';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    await requirePlatformAdmin(ownerId);
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT li.id, li.name, li.provider, li.status, li.issuer, li.created_at AS "createdAt",
              (SELECT count(*) FROM lms_course_links l WHERE l.integration_id = li.id) AS "linkedCourses"
         FROM lms_integrations li ORDER BY li.created_at DESC`,
    );
    return json(
      {
        integrations: rows,
        implementedProviders: availableProviders(),
        note:
          'The platform works without any LMS. Only MANUAL is implemented: grades are exported ' +
          'and carried across by a person. An LTI 1.3 adapter implements LmsProvider and ' +
          'registers itself; nothing above that interface changes.',
      },
      200,
      headers,
    );
  });
}

export function POST(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : 'create';
    const pool = await level2Pool();

    if (action === 'create') {
      const actor = await requirePlatformAdmin(ownerId);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return apiError(400, 'NAME_REQUIRED', 'a name is required', headers);
      const provider = typeof body.provider === 'string' ? body.provider : 'MANUAL';
      const { implemented } = providerFor(provider);

      const { rows } = await pool.query(
        `INSERT INTO lms_integrations (name, provider, issuer, client_id, deployment_id, status, config, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, provider, status`,
        [name, provider, body.issuer ?? null, body.clientId ?? null, body.deploymentId ?? null,
         implemented ? 'ACTIVE' : 'INACTIVE', body.config ?? null, actor.profileId],
      );
      const created = rows[0] as Record<string, unknown>;
      return json(
        {
          ...created,
          implemented,
          // An unimplemented provider is created INACTIVE and says so, rather
          // than looking configured and silently doing nothing.
          note: implemented
            ? 'Ready. Nothing is transmitted by the manual provider.'
            : `No adapter for "${provider}" exists yet, so this integration is INACTIVE and will send nothing.`,
        },
        201,
        headers,
      );
    }

    if (action === 'link') {
      const stageId = typeof body.stageId === 'string' ? body.stageId : '';
      const integrationId = typeof body.integrationId === 'string' ? body.integrationId : '';
      const lmsCourseId = typeof body.lmsCourseId === 'string' ? body.lmsCourseId.trim() : '';
      if (!stageId || !integrationId || !lmsCourseId) {
        return apiError(400, 'LINK_REQUIRED', 'a course, an integration and an LMS course id are required', headers);
      }
      await requireCourseOwner(ownerId, stageId);
      const { rows } = await pool.query(
        `INSERT INTO lms_course_links (integration_id, course_id, lms_course_id, lms_context_label)
         SELECT $1, c.id, $3, $4 FROM courses c WHERE c.openmaic_stage_id = $2
         ON CONFLICT (integration_id, course_id)
           DO UPDATE SET lms_course_id = EXCLUDED.lms_course_id,
                         lms_context_label = EXCLUDED.lms_context_label
         RETURNING id, lms_course_id AS "lmsCourseId"`,
        [integrationId, stageId, lmsCourseId, body.contextLabel ?? null],
      );
      if (!rows[0]) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);
      return json(rows[0], 200, headers);
    }

    if (action === 'post-grade') {
      const responseId = typeof body.responseId === 'string' ? body.responseId : '';
      if (!responseId) return apiError(400, 'RESPONSE_REQUIRED', 'a response is required', headers);

      const { rows: ctx } = await pool.query(
        `SELECT c.openmaic_stage_id AS "stageId", l.integration_id AS "integrationId",
                l.lms_course_id AS "lmsCourseId", li.provider, li.config
           FROM learner_responses lr
           JOIN courses c ON c.id = lr.course_id
           LEFT JOIN lms_course_links l ON l.course_id = c.id
           LEFT JOIN lms_integrations li ON li.id = l.integration_id
          WHERE lr.id = $1`,
        [responseId],
      );
      const found = ctx[0] as
        | { stageId: string; integrationId: string | null; lmsCourseId: string | null;
            provider: string | null; config: Record<string, unknown> | null }
        | undefined;
      if (!found) return apiError(404, 'RESPONSE_NOT_FOUND', 'no such response', headers);
      const actor = await requireCourseOwner(ownerId, found.stageId);
      if (!found.integrationId) {
        return apiError(409, 'NOT_LINKED', 'this course is not linked to an LMS', headers);
      }

      const grade = await prepareGrade(responseId);
      if (!grade) {
        // The same rule as everywhere else, and it matters most here: an
        // unreviewed AI score never leaves the platform.
        return apiError(409, 'NO_FINAL_SCORE',
          'this response has no final score yet — an AI score is not final until a human has reviewed it', headers);
      }

      const { provider, implemented } = providerFor(found.provider ?? 'MANUAL');
      const result = await provider.postGrade(found.config ?? {},
        { lmsCourseId: found.lmsCourseId ?? '' }, grade);

      const { rows } = await pool.query(
        `INSERT INTO lms_grade_postings (integration_id, response_id, line_item, score, max_score, status, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status`,
        [found.integrationId, responseId, grade.lineItem, grade.score, grade.maxScore,
         result.sent ? 'SENT' : 'PREPARED', result.detail],
      );
      await audit({ profileId: actor.profileId }, 'DATA_EXPORTED',
        { type: 'response', id: responseId },
        { to: 'lms', provider: found.provider, sent: result.sent });

      return json({ ...(rows[0] as object), sent: result.sent, implemented, grade, detail: result.detail },
        201, headers);
    }

    return apiError(400, 'UNKNOWN_ACTION', 'action must be create, link or post-grade', headers);
  });
}
