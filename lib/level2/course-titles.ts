/**
 * Level 2 — course names that stay distinguishable.
 *
 * An instructor could own six courses called "Course A" and nothing on the
 * dashboard, in an export, or in a results table could tell them apart. The
 * database now refuses it (`courses_owner_title_unique`, per owner, excluding
 * archived), and these helpers decide what the product does about it.
 *
 * Two different situations, two different answers:
 *
 * - the person **typed** the name — renaming, or naming a copy — so they are
 *   told it is taken, because silently changing what someone typed is worse
 *   than refusing it;
 * - the system **generated** the name — the placeholder for a new course, or
 *   the "(copy)" suffix — so it is numbered until it is free, because failing
 *   a creation over a name nobody chose would be absurd.
 */
import type { Queryable } from '@/lib/server/persistence-hooks';

/** Is this name already taken among the owner's live courses? */
export async function titleTaken(
  db: Queryable,
  ownerProfileId: string,
  title: string,
  exceptStageId?: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM courses
      WHERE owner_instructor_id = $1
        AND lower(title) = lower($2)
        AND status <> 'ARCHIVED'
        AND ($3::text IS NULL OR openmaic_stage_id <> $3)
      LIMIT 1`,
    [ownerProfileId, title.trim(), exceptStageId ?? null],
  );
  return rows.length > 0;
}

/**
 * "Untitled course" → "Untitled course 2" → "Untitled course 3"…
 * Bounded, so a pathological case ends in a readable failure rather than a
 * loop; a hundred courses of the same generated name is already a sign that
 * something else is wrong.
 */
export async function freeTitleNear(
  db: Queryable,
  ownerProfileId: string,
  desired: string,
): Promise<string> {
  const base = desired.trim();
  if (!(await titleTaken(db, ownerProfileId, base))) return base;
  for (let n = 2; n <= 99; n += 1) {
    const candidate = `${base} ${n}`;
    if (!(await titleTaken(db, ownerProfileId, candidate))) return candidate;
  }
  return `${base} ${Date.now()}`;
}
