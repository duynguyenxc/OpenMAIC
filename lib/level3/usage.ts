/**
 * Level 3D — usage accounting.
 *
 * *"Add usage monitoring. Track where technically possible: model; request
 * count; token/input usage; token/output usage; estimated cost. Aggregate by
 * course; instructor; study; institution."*
 *
 * And the sentence that stops this becoming an excuse: *"Do not block Level 3
 * solely because exact provider billing data are unavailable."*
 *
 * So token counts are **nullable** and a missing one stays missing. A provider
 * that does not report usage leaves the column empty rather than having a
 * number estimated into it and later mistaken for a measurement. `requests`
 * is always counted, because that one is always knowable.
 *
 * Prices are a local table, clearly labelled as such. They are what the
 * operator believes, not what the invoice says, and `estimated_cost` is named
 * for exactly that reason.
 */
import { level2Pool } from '@/lib/level2/db';

/** USD per million tokens, as of October 2026. An operator's own figures. */
const PRICES: Record<string, { input: number; output: number }> = {
  'openai:gpt-4.1': { input: 2.0, output: 8.0 },
  'openai:gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'openai:gpt-4o': { input: 2.5, output: 10.0 },
  'openai:gpt-4o-mini': { input: 0.15, output: 0.6 },
};

export function estimateCost(
  model: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  if (!model) return null;
  const price = PRICES[model];
  // No price for this model means no estimate. An invented number is worse
  // than an empty column, because only one of the two can be mistaken for a
  // measurement.
  if (!price) return null;
  if (inputTokens === null && outputTokens === null) return null;
  return (
    ((inputTokens ?? 0) / 1_000_000) * price.input +
    ((outputTokens ?? 0) / 1_000_000) * price.output
  );
}

export async function recordUsage(input: {
  stage: string;
  model: string | null;
  purpose?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  courseId?: string | null;
  studyId?: string | null;
  institutionId?: string | null;
  actorId?: string | null;
  responseId?: string | null;
}): Promise<void> {
  try {
    const pool = await level2Pool();
    await pool.query(
      `INSERT INTO model_usage (stage, model, purpose, input_tokens, output_tokens,
                                estimated_cost, course_id, study_id, institution_id,
                                actor_id, response_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.stage, input.model, input.purpose ?? null,
        input.inputTokens ?? null, input.outputTokens ?? null,
        estimateCost(input.model, input.inputTokens ?? null, input.outputTokens ?? null),
        input.courseId ?? null, input.studyId ?? null, input.institutionId ?? null,
        input.actorId ?? null, input.responseId ?? null,
      ],
    );
  } catch (error) {
    // Accounting must never be the reason a student's work fails.
    console.error('[level3d] usage write failed', error);
  }
}

export type UsageDimension = 'course' | 'instructor' | 'study' | 'institution' | 'model';

/** The four aggregates the instruction names, plus by model. */
export async function usageBy(dimension: UsageDimension): Promise<
  Array<{ key: string; label: string; requests: number; inputTokens: number | null;
          outputTokens: number | null; estimatedCost: number | null; knownTokens: number }>
> {
  const pool = await level2Pool();
  const select: Record<UsageDimension, string> = {
    course: `c.openmaic_stage_id AS key, c.title AS label`,
    instructor: `up.id::text AS key, up.email AS label`,
    study: `s.id::text AS key, s.title AS label`,
    institution: `i.id::text AS key, i.short_name AS label`,
    model: `coalesce(mu.model, 'unknown') AS key, coalesce(mu.model, 'unknown') AS label`,
  };
  const join: Record<UsageDimension, string> = {
    course: `JOIN courses c ON c.id = mu.course_id`,
    instructor: `JOIN user_profiles up ON up.id = mu.actor_id`,
    study: `JOIN studies s ON s.id = mu.study_id`,
    institution: `JOIN institutions i ON i.id = mu.institution_id`,
    model: ``,
  };

  const { rows } = await pool.query(
    `SELECT ${select[dimension]},
            count(*)::int                      AS requests,
            sum(mu.input_tokens)::int          AS "inputTokens",
            sum(mu.output_tokens)::int         AS "outputTokens",
            sum(mu.estimated_cost)::float      AS "estimatedCost",
            -- How much of the total actually reported tokens. Without this a
            -- small cost could mean cheap models or an unreporting provider.
            count(mu.input_tokens)::int        AS "knownTokens"
       FROM model_usage mu ${join[dimension]}
      GROUP BY 1, 2
      ORDER BY requests DESC`,
  );
  return rows as never;
}
