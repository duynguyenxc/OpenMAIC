/**
 * Level 3A — one study: read it, change it, remove it.
 *
 * None of this existed. A study could be created with a title and an
 * investigator and was then fixed for ever as DRAFT with no protocol
 * identifier: the status could not be moved to ACTIVE, the identifier could
 * not be set, a mistyped investigator could not be corrected, and a study made
 * by accident stayed in the list for good (O6). The seeded fixture study shows
 * `PROTO-2026-001` and ACTIVE only because it was written in SQL — the product
 * could not reproduce its own fixture data.
 *
 * Removal follows the rule Level 2 already settled for courses, because the
 * reason is the same and a second rule would only be a second thing to
 * remember: a study that **holds nothing** is deleted; a study that holds
 * participants or events is **CLOSED** instead, because `research_participants`
 * and `research_events` cascade from it and a misplaced click must not be able
 * to destroy a dataset. An administrator may still force it by sending the
 * exact title back in `confirmTitle`.
 */
import { requireAuthenticatedUser } from '@/lib/level2/authorization';
import { requirePlatformAdmin, requireStudyAccess } from '@/lib/level3/authorization';
import { level2Pool } from '@/lib/level2/db';
import { audit } from '@/lib/level3/audit';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ studyId: string }> };

const STATUSES = new Set(['DRAFT', 'ACTIVE', 'CLOSED']);

/** Anyone authorized for the study may read it; the list route already hides it from students. */
export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { studyId } = await params;
    await requireAuthenticatedUser(ownerId);
    await requireStudyAccess(ownerId, studyId);

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT s.id, s.title, s.description, s.status,
              s.protocol_identifier AS "protocolIdentifier",
              s.start_date AS "startDate", s.end_date AS "endDate",
              pi.email AS "principalInvestigator",
              (SELECT count(*) FROM study_courses sc WHERE sc.study_id = s.id) AS courses,
              (SELECT count(*) FROM research_participants rp WHERE rp.study_id = s.id) AS participants,
              (SELECT count(*) FROM research_events e WHERE e.study_id = s.id) AS events
         FROM studies s
         LEFT JOIN user_profiles pi ON pi.id = s.principal_investigator
        WHERE s.id = $1`,
      [studyId],
    );
    if (!rows[0]) return apiError(404, 'STUDY_NOT_FOUND', 'no such study', headers);
    return json(rows[0], 200, headers);
  });
}

/** Configure the study. ADMIN only, as creating one is. */
export function PATCH(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { studyId } = await params;
    const actor = await requirePlatformAdmin(ownerId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const pool = await level2Pool();
    const { rows: current } = await pool.query(`SELECT id FROM studies WHERE id = $1`, [studyId]);
    if (!current[0]) return apiError(404, 'STUDY_NOT_FOUND', 'no such study', headers);

    const updates: string[] = [];
    const values: unknown[] = [studyId];
    const push = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (typeof body.title === 'string') {
      const title = body.title.trim();
      if (!title) return apiError(400, 'TITLE_REQUIRED', 'a study title cannot be empty', headers);
      push('title', title);
    }
    if (typeof body.description === 'string') {
      push('description', body.description.trim() || null);
    }
    if (typeof body.protocolIdentifier === 'string') {
      push('protocol_identifier', body.protocolIdentifier.trim() || null);
    }
    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !STATUSES.has(body.status)) {
        return apiError(400, 'INVALID_STATUS', 'status must be DRAFT, ACTIVE or CLOSED', headers);
      }
      push('status', body.status);
    }
    for (const [field, column] of [
      ['startDate', 'start_date'],
      ['endDate', 'end_date'],
    ] as const) {
      const value = body[field];
      if (value === null) push(column, null);
      else if (typeof value === 'string' && value.trim()) {
        // A date the database cannot parse would otherwise surface as a 500.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
          return apiError(400, 'INVALID_DATE', `${field} must be a date like 2026-10-22`, headers);
        }
        push(column, value.trim());
      }
    }
    if (typeof body.principalInvestigator === 'string') {
      const email = body.principalInvestigator.trim();
      if (!email) {
        push('principal_investigator', null);
      } else {
        const { rows } = await pool.query(
          `SELECT id, role FROM user_profiles WHERE lower(email) = lower($1)`,
          [email],
        );
        const candidate = rows[0] as { id?: string; role?: string } | undefined;
        if (!candidate?.id)
          return apiError(404, 'NO_SUCH_USER', 'no account with that email', headers);
        // The same rule the create route enforces: leading a study is read and
        // export access to everybody else's data on it.
        if (candidate.role === 'STUDENT') {
          return apiError(
            409,
            'STUDENT_CANNOT_LEAD_STUDY',
            'that account is a student; a study is led by a researcher, instructor or administrator',
            headers,
          );
        }
        push('principal_investigator', candidate.id);
      }
    }

    if (!updates.length) return apiError(400, 'NOTHING_TO_UPDATE', 'no change was given', headers);

    const { rows } = await pool.query(
      `UPDATE studies SET ${updates.join(', ')} WHERE id = $1
        RETURNING id, title, status, protocol_identifier AS "protocolIdentifier"`,
      values,
    );
    await audit(
      { profileId: actor.profileId },
      'STUDY_UPDATED',
      { type: 'study', id: studyId },
      { fields: updates.map((u) => u.split(' = ')[0]) },
    );
    return json(rows[0], 200, headers);
  });
}

/** Remove it, or close it when that would take data with it. */
export function DELETE(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { studyId } = await params;
    const actor = await requirePlatformAdmin(ownerId);
    const body = (await req.json().catch(() => ({}))) as { confirmTitle?: unknown };

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT s.title,
              (SELECT count(*)::int FROM research_participants rp WHERE rp.study_id = s.id) AS participants,
              (SELECT count(*)::int FROM research_events e WHERE e.study_id = s.id) AS events
         FROM studies s WHERE s.id = $1`,
      [studyId],
    );
    const study = rows[0] as { title: string; participants: number; events: number } | undefined;
    if (!study) return apiError(404, 'STUDY_NOT_FOUND', 'no such study', headers);

    const holds = study.participants + study.events;
    const confirmed =
      typeof body.confirmTitle === 'string' && body.confirmTitle.trim() === study.title;

    if (holds === 0 || confirmed) {
      await pool.query(`DELETE FROM studies WHERE id = $1`, [studyId]);
      await audit(
        { profileId: actor.profileId },
        'STUDY_DELETED',
        { type: 'study', id: studyId },
        { title: study.title, participants: study.participants, events: study.events, confirmed },
      );
      return json(
        {
          deleted: true,
          title: study.title,
          participants: study.participants,
          events: study.events,
        },
        200,
        headers,
      );
    }

    await pool.query(`UPDATE studies SET status = 'CLOSED' WHERE id = $1`, [studyId]);
    await audit(
      { profileId: actor.profileId },
      'STUDY_CLOSED',
      { type: 'study', id: studyId },
      { title: study.title, participants: study.participants, events: study.events },
    );
    return json(
      {
        closed: true,
        title: study.title,
        participants: study.participants,
        events: study.events,
        message:
          `This study holds ${study.participants} participant record(s) and ${study.events} event(s), ` +
          'so it was closed rather than deleted. Nothing was destroyed. To remove it and its data, ' +
          'send the exact title back in confirmTitle.',
      },
      200,
      headers,
    );
  });
}
