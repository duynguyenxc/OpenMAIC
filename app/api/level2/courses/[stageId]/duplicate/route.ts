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
import { TITLE_MAX, titleProblem } from '@/lib/level2/validation';
import { freeTitleNear } from '@/lib/level2/course-titles';
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

      // The name to copy from is the platform's, not the document's. Renaming
      // a course writes to `courses.title` and leaves OpenMAIC's own
      // `stage.name` alone — deliberately, so that renaming cannot fail
      // halfway across two stores — so the two drift apart. Taking the
      // document's name here produced "Course A (copy)" from a course the
      // instructor sees as "Demo 1 — Realist Evaluation", which is the sort of
      // small lie that makes a product feel untrustworthy.
      const pool = await level2Pool();
      const { rows: sourceRow } = await pool.query(
        `SELECT title, owner_instructor_id AS "ownerId"
           FROM courses WHERE openmaic_stage_id = $1`,
        [stageId],
      );
      const sourceCourse = sourceRow[0] as { title?: string; ownerId?: string } | undefined;
      const platformTitle = sourceCourse?.title ?? source.stage.name ?? 'Course';

      // " (copy)" used to be appended without checking the cap, so duplicating
      // a 196-character course failed with "a course title cannot be longer
      // than 200 characters" and the only way out was to rename the original
      // first (O13). A suffix nobody typed must never be the thing that fails.
      const SUFFIX = ' (copy)';
      const generated =
        platformTitle.length + SUFFIX.length <= TITLE_MAX
          ? `${platformTitle}${SUFFIX}`
          : `${platformTitle.slice(0, TITLE_MAX - SUFFIX.length).trimEnd()}${SUFFIX}`;

      const askedFor =
        typeof body.title === 'string' && body.title.trim() ? body.title.trim() : generated;

      const problem = titleProblem(askedFor);
      if (problem) return apiError(400, 'INVALID_TITLE', problem, headers);

      // Two clicks used to produce two courses, and with no way to delete one
      // of them the mistake was permanent. A copy of the same source, with the
      // same title, by the same person, moments ago, is the same request.
      //
      // The check has to be serialised or it races itself: two requests a few
      // milliseconds apart each looked, each saw nothing, and each created a
      // course. An advisory lock on (owner, title) makes the second wait for
      // the first to finish, so it sees the row and returns it. The lock is
      // released in `finally`, and it is advisory, so nothing is blocked if
      // this process dies holding it.
      const lockKey = `duplicate:${principal.ownerId}:${askedFor}`;
      const lock = await pool.connect();
      await lock.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
      try {
        const { rows: recent } = await pool.query(
          `SELECT c.openmaic_stage_id AS "stageId", c.title
           FROM courses c
           JOIN user_profiles up ON up.id = c.owner_instructor_id
          WHERE (c.title = $1 OR c.title LIKE $1 || ' %')
            AND up.auth_user_id::text = $2
            AND c.created_at > now() - interval '15 seconds'
          ORDER BY c.created_at DESC
          LIMIT 1`,
          [askedFor, (principal.ownerId ?? '').replace(/^user:/, '')],
        );
        if (recent[0]) {
          const already = recent[0] as { stageId: string; title: string };
          return json(
            {
              stageId: already.stageId,
              title: already.title,
              copiedFrom: stageId,
              deduplicated: true,
            },
            200,
            headers,
          );
        }

        // "X (copy)" is generated, not typed, so it is numbered until free:
        // "X (copy)", "X (copy) 2", "X (copy) 3". Titles are unique per owner.
        const ownerProfileId = sourceCourse?.ownerId;
        const title = ownerProfileId
          ? await freeTitleNear(pool, ownerProfileId, askedFor)
          : askedFor;

        const copyId = newStageId();

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
        await pool.query(`UPDATE courses SET title = $2 WHERE openmaic_stage_id = $1`, [
          copyId,
          title,
        ]);

        return json({ stageId: copyId, title, copiedFrom: stageId }, 201, headers);
      } finally {
        await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => {});
        lock.release();
      }
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
