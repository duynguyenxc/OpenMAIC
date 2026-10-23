/**
 * Level 3B — the assessment service.
 *
 * A service beside the classroom, not inside it. *"Add an assessment service
 * around the existing learning environment"*, and *"Do not hard-wire adaptive
 * behavior inside the core OpenMAIC renderer."* Nothing in the teaching path
 * calls this; a student's lesson runs identically whether it exists or not,
 * which is what *"Core learning experience should degrade gracefully"* means
 * in practice.
 *
 * What it must record is not negotiable, and the instruction lists it: the
 * model used, the prompt version, the rubric version, the timestamp, the raw
 * model result, the parsed score, and any human override. All of it per
 * assessment, because a course's configuration cannot answer "what scored
 * this particular answer" once the course has been reconfigured.
 *
 * **An AI score never overwrites a human one, and a human score never
 * overwrites an AI one.** They are separate rows with `assessor_kind`, and a
 * review points at both. That is what makes a later AI-vs-human comparison
 * possible at all; a system that let the second rating replace the first would
 * destroy the evidence it was built to collect.
 */
import { callLLM } from '@/lib/ai/llm';
import { level2Pool } from '@/lib/level2/db';

/** Bump when the wording below changes, so old assessments stay interpretable. */
export const ASSESSMENT_PROMPT_VERSION = 'assess-v1';

export interface RubricDimension {
  dimensionId: string;
  name: string;
  description: string | null;
  maxScore: number;
  levels: Array<{ score: number; descriptor: string }>;
}

export interface RubricForAssessment {
  id: string;
  title: string;
  version: string;
  description: string | null;
  dimensions: RubricDimension[];
}

export interface DimensionScore {
  dimensionId: string;
  score: number;
  evidence: string | null;
  confidence: number | null;
}

export interface AssessmentOutcome {
  scores: DimensionScore[];
  feedbackSuggestions: string[];
  raw: unknown;
  model: string;
  promptVersion: string;
  /** Level 3C: which retrieval request, if any, supplied the context. */
  retrievalRequestId?: string | null;
}

export async function loadRubric(rubricId: string): Promise<RubricForAssessment | null> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `SELECT id, title, version, description FROM rubrics WHERE id = $1`,
    [rubricId],
  );
  const rubric = rows[0] as
    | { id: string; title: string; version: string; description: string | null }
    | undefined;
  if (!rubric) return null;

  const { rows: dims } = await pool.query(
    `SELECT dimension_id AS "dimensionId", name, description, max_score AS "maxScore"
       FROM rubric_dimensions WHERE rubric_id = $1 ORDER BY ordering, dimension_id`,
    [rubricId],
  );
  const { rows: levels } = await pool.query(
    `SELECT dimension_id AS "dimensionId", score, descriptor
       FROM rubric_levels WHERE rubric_id = $1 ORDER BY dimension_id, score`,
    [rubricId],
  );

  return {
    ...rubric,
    dimensions: (dims as Array<Omit<RubricDimension, 'levels'>>).map((d) => ({
      ...d,
      levels: (levels as Array<{ dimensionId: string; score: number; descriptor: string }>)
        .filter((l) => l.dimensionId === d.dimensionId)
        .map(({ score, descriptor }) => ({ score, descriptor })),
    })),
  };
}

function rubricAsText(rubric: RubricForAssessment): string {
  return rubric.dimensions
    .map((d) => {
      const levels = d.levels.map((l) => `      ${l.score} = ${l.descriptor}`).join('\n');
      return `  - id: ${d.dimensionId}\n    name: ${d.name}\n    max score: ${d.maxScore}${
        d.description ? `\n    what it means: ${d.description}` : ''
      }${levels ? `\n    levels:\n${levels}` : ''}`;
    })
    .join('\n');
}

/**
 * Assess one response against one rubric.
 *
 * The model is asked for evidence and a confidence per dimension, not only a
 * number. A score with no quotation from the answer is not reviewable, and the
 * instruction asks for *"evidence/explanation; confidence where appropriate"*
 * precisely so a human reviewer can disagree with something specific.
 *
 * Out-of-range scores are clamped rather than rejected, and the raw result is
 * stored whatever happens, so a malformed answer is visible afterwards instead
 * of being thrown away.
 */
export async function assessResponse(input: {
  responseText: string;
  activityPrompt?: string | null;
  courseContext?: string | null;
  referenceAnswer?: string | null;
  rubric: RubricForAssessment;
  model: unknown;
  modelString: string;
  serverManaged?: boolean;
  /**
   * Level 3C. Passages retrieved through the KnowledgeProvider interface,
   * already labelled with the source each came from. The service does not
   * retrieve them itself: what an assessment was allowed to see is a study's
   * decision, made by the caller, not a service's.
   */
  knowledgeContext?: string | null;
  /** A bounded agent's rules, if the course runs under one. */
  agentRules?: { prohibited?: string | null; uncertainty?: string | null } | null;
}): Promise<AssessmentOutcome> {
  const { rubric } = input;

  const system = [
    'You are an assessment assistant for a university course.',
    'Score the student response against the rubric, one score per dimension.',
    "Quote the student's own words as evidence for each score. If the response",
    'contains no evidence for a dimension, say so and score it lowest rather',
    'than guessing. Give a confidence between 0 and 1 for each dimension.',
    'Then suggest up to three pieces of feedback a teacher could give.',
    input.knowledgeContext
      ? 'Reference material is provided below. Use it where it bears on the answer, and say so. Do not invent material that is not there.'
      : '',
    input.agentRules?.prohibited ? `You must not: ${input.agentRules.prohibited}` : '',
    input.agentRules?.uncertainty ? `When uncertain: ${input.agentRules.uncertainty}` : '',
    'Reply with JSON only, no prose and no code fences, shaped exactly as:',
    '{"scores":[{"dimensionId":"...","score":0,"evidence":"...","confidence":0.0}],',
    ' "feedbackSuggestions":["..."]}',
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = [
    `RUBRIC "${rubric.title}" v${rubric.version}`,
    rubric.description ? `About this rubric: ${rubric.description}` : '',
    'Dimensions:',
    rubricAsText(rubric),
    '',
    input.activityPrompt ? `TASK THE STUDENT WAS GIVEN:\n${input.activityPrompt}` : '',
    input.courseContext ? `COURSE CONTEXT:\n${input.courseContext}` : '',
    input.referenceAnswer
      ? `REFERENCE ANSWER (for your judgement, not to be quoted):\n${input.referenceAnswer}`
      : '',
    input.knowledgeContext ? `REFERENCE MATERIAL:\n${input.knowledgeContext}` : '',
    '',
    `STUDENT RESPONSE:\n${input.responseText}`,
  ]
    .filter(Boolean)
    .join('\n');

  const result = await callLLM(
    { model: input.model as never, system, prompt },
    'level3-assessment',
    undefined,
    undefined,
    { serverManaged: input.serverManaged },
  );

  const text = String(result.text ?? '')
    .replace(/^```(?:json)?|```$/gm, '')
    .trim();
  let parsed: { scores?: unknown; feedbackSuggestions?: unknown } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    // Keep the raw text. An unparseable answer is a fact about the model's
    // behaviour and belongs in the record, not in a thrown exception.
    return {
      scores: [],
      feedbackSuggestions: [],
      raw: { unparsed: text },
      model: input.modelString,
      promptVersion: ASSESSMENT_PROMPT_VERSION,
    };
  }

  const byId = new Map(rubric.dimensions.map((d) => [d.dimensionId, d]));
  const scores: DimensionScore[] = Array.isArray(parsed.scores)
    ? (parsed.scores as Array<Record<string, unknown>>)
        .filter((s) => typeof s.dimensionId === 'string' && byId.has(s.dimensionId))
        .map((s) => {
          const dimension = byId.get(s.dimensionId as string)!;
          const raw = Number(s.score);
          return {
            dimensionId: s.dimensionId as string,
            score: Number.isFinite(raw) ? Math.max(0, Math.min(dimension.maxScore, raw)) : 0,
            evidence: typeof s.evidence === 'string' ? s.evidence : null,
            confidence:
              typeof s.confidence === 'number' && Number.isFinite(s.confidence)
                ? Math.max(0, Math.min(1, s.confidence))
                : null,
          };
        })
    : [];

  return {
    scores,
    feedbackSuggestions: Array.isArray(parsed.feedbackSuggestions)
      ? (parsed.feedbackSuggestions as unknown[])
          .filter((f): f is string => typeof f === 'string')
          .slice(0, 3)
      : [],
    raw: parsed,
    model: input.modelString,
    promptVersion: ASSESSMENT_PROMPT_VERSION,
  };
}

/**
 * The three scores the instruction asks to be kept apart, for one response.
 *
 * `FINAL` is **derived**, never stored over anything: a human assessment if a
 * review produced one, otherwise the AI assessment if a review accepted it,
 * otherwise nothing. An unreviewed AI score is not a final score, and saying
 * so is the difference between a research record and a grade book.
 */
export async function scoresFor(responseId: string): Promise<{
  ai: { assessmentId: string; model: string | null; scores: DimensionScore[] } | null;
  human: { assessmentId: string; reviewerId: string | null; scores: DimensionScore[] } | null;
  review: { decision: string; reviewerId: string | null; feedback: string | null } | null;
  final: { source: 'HUMAN' | 'AI_ACCEPTED' | 'NONE'; scores: DimensionScore[] };
}> {
  const pool = await level2Pool();

  const load = async (kind: 'AI' | 'HUMAN') => {
    const { rows } = await pool.query(
      `SELECT id, model, assessor_id AS "assessorId" FROM assessments
        WHERE response_id = $1 AND assessor_kind = $2
        ORDER BY created_at DESC LIMIT 1`,
      [responseId, kind],
    );
    const a = rows[0] as
      | { id: string; model: string | null; assessorId: string | null }
      | undefined;
    if (!a) return null;
    const { rows: s } = await pool.query(
      `SELECT dimension_id AS "dimensionId", score::float AS score, evidence,
              confidence::float AS confidence
         FROM assessment_scores WHERE assessment_id = $1 ORDER BY dimension_id`,
      [a.id],
    );
    return { assessment: a, scores: s as DimensionScore[] };
  };

  const [ai, human] = await Promise.all([load('AI'), load('HUMAN')]);

  const { rows: reviews } = await pool.query(
    `SELECT decision, reviewer_id AS "reviewerId", feedback FROM assessment_reviews
      WHERE response_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [responseId],
  );
  const review =
    (reviews[0] as
      | { decision: string; reviewerId: string | null; feedback: string | null }
      | undefined) ?? null;

  const final = human
    ? { source: 'HUMAN' as const, scores: human.scores }
    : review?.decision === 'ACCEPTED' && ai
      ? { source: 'AI_ACCEPTED' as const, scores: ai.scores }
      : { source: 'NONE' as const, scores: [] };

  return {
    ai: ai
      ? { assessmentId: ai.assessment.id, model: ai.assessment.model, scores: ai.scores }
      : null,
    human: human
      ? {
          assessmentId: human.assessment.id,
          reviewerId: human.assessment.assessorId,
          scores: human.scores,
        }
      : null,
    review,
    final,
  };
}
