/**
 * Level 3C — agent configurations.
 *
 * *"Create an instructor/researcher agent configuration layer. Allow explicit
 * specification of: agent role; pedagogical function; permitted knowledge
 * resources; prohibited behavior; response style; feedback policy; escalation
 * rule; confidence/uncertainty behavior."* and immediately: *"Do not hard-code
 * these roles. Make them configurable templates."*
 *
 * Versioned, because a study cannot be reproduced against a configuration that
 * changed underneath it — the same reason rubrics and templates are.
 *
 * `permittedResources` is the **bound**. An agent restricted to one corpus is
 * an experimental condition, and the restriction is enforced at retrieval
 * rather than requested in a prompt.
 */
import { requireAuthenticatedUser } from '@/lib/level2/authorization';
import { requireCourseOwner } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { audit } from '@/lib/level3/audit';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);
    if (actor.role === 'STUDENT') {
      return apiError(403, 'FORBIDDEN', 'agent configurations are not visible to students', headers);
    }
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT ac.id, ac.name, ac.version, ac.agent_role AS "agentRole",
              ac.pedagogical_function AS "pedagogicalFunction", ac.response_style AS "responseStyle",
              ac.prohibited_behavior AS "prohibitedBehavior", ac.escalation_rule AS "escalationRule",
              ac.uncertainty_behavior AS "uncertaintyBehavior", ac.feedback_policy AS "feedbackPolicy",
              ac.permitted_resources AS "permittedResources", ac.status,
              up.email AS "createdByEmail",
              (SELECT count(*) FROM courses c WHERE c.agent_configuration_id = ac.id) AS "usedBy"
         FROM agent_configurations ac JOIN user_profiles up ON up.id = ac.created_by
        WHERE ac.status <> 'ARCHIVED' AND ($1 = 'ADMIN' OR ac.created_by = $2 OR ac.status = 'PUBLISHED')
        ORDER BY ac.created_at DESC`,
      [actor.role, actor.profileId],
    );
    return json({ agents: rows }, 200, headers);
  });
}

export function POST(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const actor = await requireAuthenticatedUser(ownerId);
    if (actor.role === 'STUDENT') {
      return apiError(403, 'FORBIDDEN', 'students cannot create agent configurations', headers);
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return apiError(400, 'NAME_REQUIRED', 'a name is required', headers);

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `INSERT INTO agent_configurations
         (name, version, agent_role, pedagogical_function, response_style, prohibited_behavior,
          escalation_rule, uncertainty_behavior, feedback_policy, permitted_resources,
          created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PUBLISHED')
       ON CONFLICT (created_by, lower(name), version) DO NOTHING
       RETURNING id, name, version`,
      [
        name,
        typeof body.version === 'string' && body.version.trim() ? body.version.trim() : '1.0',
        body.agentRole ?? null, body.pedagogicalFunction ?? null, body.responseStyle ?? null,
        body.prohibitedBehavior ?? null, body.escalationRule ?? null,
        body.uncertaintyBehavior ?? null, body.feedbackPolicy ?? null,
        Array.isArray(body.permittedResources) ? body.permittedResources : null,
        actor.profileId,
      ],
    );
    if (!rows[0]) {
      return apiError(409, 'VERSION_EXISTS', 'you already have an agent of that name at that version', headers);
    }
    const created = rows[0] as { id: string; name: string; version: string };
    await audit({ profileId: actor.profileId }, 'AGENT_CONFIGURATION_CHANGED',
      { type: 'agent_configuration', id: created.id },
      { name: created.name, version: created.version });
    return json(created, 201, headers);
  });
}

/** Run a course section under an agent configuration. */
export function PATCH(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const stageId = typeof body.stageId === 'string' ? body.stageId : '';
    const agentId = typeof body.agentConfigurationId === 'string' ? body.agentConfigurationId : null;
    if (!stageId) return apiError(400, 'COURSE_REQUIRED', 'a course is required', headers);
    await requireCourseOwner(ownerId, stageId);

    const pool = await level2Pool();
    const { rows } = await pool.query(
      `UPDATE courses SET agent_configuration_id = $2 WHERE openmaic_stage_id = $1
       RETURNING openmaic_stage_id AS "stageId", agent_configuration_id AS "agentConfigurationId"`,
      [stageId, agentId],
    );
    if (!rows[0]) return apiError(404, 'COURSE_NOT_FOUND', 'no such course', headers);
    return json(rows[0], 200, headers);
  });
}
