/** Level 2 — co-instructors. Listing: any instructor on the course. Changing: OWNER. */
import { requireCourseInstructor, requireCourseOwner } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { looksLikeEmail } from '@/lib/level2/validation';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };
const SHAREABLE = new Set(['EDITOR', 'VIEWER']);

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    await requireCourseInstructor(ownerId, stageId);
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT up.email, up.display_name AS "displayName", ci.permission, ci.created_at AS "addedAt"
         FROM course_instructors ci
         JOIN courses c        ON c.id = ci.course_id
         JOIN user_profiles up ON up.id = ci.instructor_id
        WHERE c.openmaic_stage_id = $1
        -- Owner first, then by name. Ordering on the permission text put
        -- EDITOR above OWNER above VIEWER, so a permission change made the
        -- owner row jump up or down the list for no reason (O10).
        ORDER BY (ci.permission <> 'OWNER'), coalesce(up.display_name, up.email)`,
      [stageId],
    );
    return json({ instructors: rows }, 200, headers);
  });
}

export function POST(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    const actor = await requireCourseOwner(ownerId, stageId);
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; permission?: unknown };

    if (typeof body.email !== 'string' || !body.email.trim()) {
      return apiError(400, 'EMAIL_REQUIRED', 'an instructor email is required', headers);
    }
    if (!looksLikeEmail(body.email)) {
      return apiError(400, 'MALFORMED_EMAIL', 'that is not an email address', headers);
    }
    // OWNER is not shareable: the partial unique index allows exactly one, and
    // transferring ownership is a different operation from adding a colleague.
    const permission = typeof body.permission === 'string' ? body.permission : 'EDITOR';
    if (!SHAREABLE.has(permission)) {
      return apiError(400, 'INVALID_PERMISSION', 'permission must be EDITOR or VIEWER', headers);
    }

    const pool = await level2Pool();
    const { rows: found } = await pool.query(
      `SELECT id, role FROM user_profiles WHERE lower(email) = lower($1)`,
      [body.email.trim()],
    );
    const invitee = found[0] as { id: string; role: string } | undefined;
    if (!invitee) return apiError(404, 'NO_SUCH_USER', 'no account with that email', headers);
    if (invitee.role === 'STUDENT') {
      return apiError(400, 'NOT_AN_INSTRUCTOR', 'students cannot be co-instructors', headers);
    }

    // The owner may not be given a lesser permission here. Without this, an
    // owner who offered their own address as a co-instructor had the upsert
    // below overwrite OWNER with EDITOR, leaving the course with no owner at
    // all and locking them out of their own course: every owner-gated call
    // then answers 403, and only an owner may repair the owner row. Found by
    // adversarial testing on 2026-10-21; see docs/LEVEL2_UPGRADE_PLAN.md S1-1.
    // Handing the course to someone else is a different, deliberate operation:
    // POST /api/level2/courses/<id>/owner.
    const { rows: ownerRows } = await pool.query(
      `SELECT 1
         FROM course_instructors ci
         JOIN courses c ON c.id = ci.course_id
        WHERE c.openmaic_stage_id = $1 AND ci.instructor_id = $2 AND ci.permission = 'OWNER'`,
      [stageId, invitee.id],
    );
    if (ownerRows[0]) {
      return apiError(
        409,
        'OWNER_CANNOT_BE_DEMOTED',
        'that account owns this course; transfer ownership instead of adding it as a co-instructor',
        headers,
      );
    }

    const { rows: courses } = await pool.query(
      `SELECT id FROM courses WHERE openmaic_stage_id = $1`,
      [stageId],
    );
    const courseId = (courses[0] as { id?: string } | undefined)?.id;
    if (!courseId) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);

    await pool.query(
      `INSERT INTO course_instructors (course_id, instructor_id, permission, added_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (course_id, instructor_id) DO UPDATE SET permission = EXCLUDED.permission
         WHERE course_instructors.permission <> 'OWNER'`,
      [courseId, invitee.id, permission, actor.profileId],
    );
    return json({ email: body.email, permission }, 200, headers);
  });
}

/** Removing a co-instructor deletes the grant, so access stops on the next request. */
export function DELETE(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    await requireCourseOwner(ownerId, stageId);
    const email = new URL(req.url).searchParams.get('email');
    if (!email) return apiError(400, 'EMAIL_REQUIRED', 'email query parameter is required', headers);

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `DELETE FROM course_instructors ci
         USING courses c, user_profiles up
        WHERE c.id = ci.course_id AND up.id = ci.instructor_id
          AND c.openmaic_stage_id = $1 AND lower(up.email) = lower($2)
          AND ci.permission <> 'OWNER'
        RETURNING up.email`,
      [stageId, email],
    );
    if (!rows[0]) {
      return apiError(404, 'NOT_A_CO_INSTRUCTOR', 'not a removable co-instructor of this course', headers);
    }
    return json({ removed: email }, 200, headers);
  });
}
