/**
 * Level 3A — clone a template into a course of your own.
 *
 * This is the feature the whole level exists for: *"Different instructors must
 * be able to use the SAME instructional module while keeping their classes and
 * learner data separate."*
 *
 * Four things must be true of the result, and all four fall out of cloning
 * through OpenMAIC's own document store rather than by copying rows:
 *
 * - **a new course id** — the copy is saved under a freshly generated stage id;
 * - **separate ownership** — saving fires the create hook, so the instructor
 *   doing the cloning becomes OWNER in the same transaction;
 * - **separate enrolment** — enrolments are keyed by course, and this course
 *   has none;
 * - **no learner runtime** — runtime lives in `runtime_sessions` keyed by
 *   `(stage_id, learner_key)`, and nothing here touches it, so the new stage
 *   id simply has none. *"DO NOT copy learner runtime when cloning a
 *   template"* is satisfied by construction rather than by remembering to
 *   delete something.
 *
 * It also records **which template and which version** the course came from,
 * and a configuration snapshot taken at this moment, because the question a
 * researcher asks later — what exactly did this student experience — cannot be
 * answered from settings that have since changed.
 */
import { requireAuthenticatedUser } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { freeTitleNear } from '@/lib/level2/course-titles';
import { audit } from '@/lib/level3/audit';
import { apiError, json } from '@/lib/level2/route-helpers';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ templateId: string }> };

function newStageId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let id = '';
  for (let i = 0; i < 10; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

export function POST(req: Request, { params }: Params): Promise<Response> {
  return withRequestOwner(req, async (principal, headers) => {
    const { templateId } = await params;
    try {
      const actor = await requireAuthenticatedUser(principal.ownerId);
      if (actor.role === 'STUDENT') {
        return apiError(403, 'FORBIDDEN', 'students cannot clone templates', headers);
      }

      const pool = await level2Pool();
      // Visibility is the authorization: you may clone what you may see.
      const { rows: found } = await pool.query(
        `SELECT t.id, t.title, t.version, t.source_stage_id AS "sourceStageId", t.visibility
           FROM course_templates t
          WHERE t.id = $1
            AND t.status = 'PUBLISHED'
            AND ($2 = 'ADMIN'
                 OR t.created_by = $3
                 OR t.visibility = 'COMMUNITY'
                 OR (t.visibility = 'INSTITUTION' AND t.institution_id IS NOT DISTINCT FROM
                     (SELECT primary_institution_id FROM user_profiles WHERE id = $3)))`,
        [templateId, actor.role, actor.profileId],
      );
      const template = found[0] as
        | { id: string; title: string; version: string; sourceStageId: string }
        | undefined;
      if (!template) {
        return apiError(404, 'TEMPLATE_NOT_FOUND', 'no template you may use with that id', headers);
      }

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const store = await getOwnerScopedDocumentStore(principal);
      const source = await store.loadDocument(template.sourceStageId);
      if (!source) {
        return apiError(409, 'TEMPLATE_SOURCE_MISSING', 'the course this template was published from no longer exists', headers);
      }

      const asked =
        typeof body.title === 'string' && body.title.trim() ? body.title.trim() : template.title;
      const title = await freeTitleNear(pool, actor.profileId, asked);

      const copyId = newStageId();
      const now = Date.now();
      await store.saveDocument({
        ...source,
        stage: { ...source.stage, id: copyId, name: title, createdAt: now, updatedAt: now },
        scenes: source.scenes.map((scene) => ({ ...scene, stageId: copyId })),
      } as typeof source);

      // What this section was configured with, frozen at the moment of cloning.
      const snapshot = {
        clonedFromTemplate: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        sourceStageId: template.sourceStageId,
        clonedAt: new Date().toISOString(),
        openmaicStage: {
          interactiveMode: (source.stage as unknown as Record<string, unknown>).interactiveMode ?? null,
          taskEngineMode: (source.stage as unknown as Record<string, unknown>).taskEngineMode ?? null,
          sceneCount: source.scenes.length,
        },
      };

      await pool.query(
        `UPDATE courses
            SET title = $2, template_id = $3, template_version = $4, cloned_at = now(),
                configuration_snapshot = $5,
                institution_id = (SELECT primary_institution_id FROM user_profiles WHERE id = $6)
          WHERE openmaic_stage_id = $1`,
        [copyId, title, template.id, template.version, snapshot, actor.profileId],
      );

      await audit({ profileId: actor.profileId }, 'TEMPLATE_CLONED',
        { type: 'course', id: copyId },
        { template: template.id, templateVersion: template.version, title });

      return json(
        {
          stageId: copyId,
          title,
          fromTemplate: template.id,
          templateVersion: template.version,
          learnerRuntimeCopied: false,
          enrolmentsCopied: false,
        },
        201,
        headers,
      );
    } catch (error) {
      const { AuthorizationError } = await import('@/lib/level2/authorization');
      if (error instanceof AuthorizationError) {
        return apiError(error.status, error.code, error.message, headers);
      }
      throw error;
    }
  });
}
