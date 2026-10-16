/**
 * Level 2 — Duplicate Course.
 *
 * The instruction asks for the minimum that prepares Level 3's template
 * library: *"original course remains unchanged; new course gets a new ID;
 * learner runtime does not copy; enrollment does not copy."*
 *
 * All four fall out of doing this through OpenMAIC's own document store
 * rather than by copying rows:
 *
 * - the source is only read, so it cannot change;
 * - the copy is saved under a freshly generated stage id;
 * - runtime lives in `runtime_sessions` / `runtime_records`, keyed by
 *   `(stage_id, learner_key)`. Nothing here touches them, so the new stage id
 *   simply has none;
 * - enrolments are keyed by course, and the new course has no rows.
 *
 * Saving also fires the create hooks, so the duplicating instructor becomes
 * the OWNER of the copy in the same transaction that creates it.
 */
import { requireCourseInstructor } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { apiError, json } from '@/lib/level2/route-helpers';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };

/** Same alphabet and length as the ids OpenMAIC generates. */
function newStageId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let id = '';
  for (let i = 0; i < 10; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

export function POST(req: Request, { params }: Params): Promise<Response> {
  return withRequestOwner(req, async (principal, headers) => {
    const { stageId } = await params;
    try {
      // Entitled to the source: OWNER, EDITOR, VIEWER or ADMIN. A course this
      // instructor cannot see cannot be cloned.
      await requireCourseInstructor(principal.ownerId, stageId);

      const body = (await req.json().catch(() => ({}))) as { title?: unknown };
      const store = await getOwnerScopedDocumentStore(principal);
      const source = await store.loadDocument(stageId);
      if (!source) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);

      const copyId = newStageId();
      const title =
        typeof body.title === 'string' && body.title.trim()
          ? body.title.trim()
          : `${source.stage.name ?? 'Course'} (copy)`;

      const now = Date.now();
      // Every scene carries the id of the document it belongs to, and the
      // storage layer refuses a save where the two disagree. Rewriting only
      // stage.id would leave each scene pointing at the original.
      await store.saveDocument({
        ...source,
        stage: { ...source.stage, id: copyId, name: title, createdAt: now, updatedAt: now },
        scenes: source.scenes.map((scene) => ({ ...scene, stageId: copyId })),
      } as typeof source);

      // The hook created the row with a placeholder title; give it the real one.
      const pool = await level2Pool();
      await pool.query(`UPDATE courses SET title = $2 WHERE openmaic_stage_id = $1`, [copyId, title]);

      return json({ stageId: copyId, title, copiedFrom: stageId }, 201, headers);
    } catch (error) {
      const { AuthorizationError } = await import('@/lib/level2/authorization');
      if (error instanceof AuthorizationError) {
        return apiError(error.status, error.code, error.message, headers);
      }
      console.error('[level2] duplicate failed', error);
      return apiError(500, 'INTERNAL', 'duplicate failed', headers);
    }
  });
}
