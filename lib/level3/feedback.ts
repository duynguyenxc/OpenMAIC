/**
 * Level 3B — adaptive feedback, as a service.
 *
 * *"Build adaptive feedback as a separate service. Do not hard-wire adaptive
 * behavior inside the core OpenMAIC renderer."* Nothing in the classroom calls
 * this. A lesson runs the same whether feedback is on, off, or broken, which
 * is the only way *"Core learning experience should degrade gracefully"* can
 * be true rather than hoped for.
 *
 * The instructor sets the policy per activity; the service refuses rather than
 * improvises when the policy says no. And **every piece of feedback generated
 * is recorded**, whether or not a learner ever sees it, because
 * *"Record all generated feedback"* is how an analyst later tells the
 * difference between feedback that was offered and feedback that worked.
 */
import { callLLM } from '@/lib/ai/llm';
import { level2Pool } from '@/lib/level2/db';
import type { DimensionScore, RubricForAssessment } from './assessment';

export const FEEDBACK_PROMPT_VERSION = 'feedback-v1';

export type FeedbackPolicy =
  | 'OFF'
  | 'ON'
  | 'AFTER_FIRST_RESPONSE'
  | 'AFTER_SUBMISSION'
  | 'ON_REQUEST';

export type FeedbackKind =
  | 'HINT'
  | 'SOCRATIC_QUESTION'
  | 'MISCONCEPTION_PROMPT'
  | 'REQUEST_FOR_EXPLANATION'
  | 'EXAMPLE'
  | 'REVIEW_SUGGESTION';

/**
 * Whether the policy allows feedback here, and why not when it does not.
 *
 * `AFTER_FIRST_RESPONSE` means from the second attempt onwards: the first
 * answer is the measurement, and feeding back into it would contaminate what
 * a study is trying to observe.
 */
export function policyAllows(
  policy: FeedbackPolicy,
  context: { attemptNumber: number; requested: boolean; submitted: boolean },
): { allowed: boolean; reason?: string } {
  switch (policy) {
    case 'OFF':
      return { allowed: false, reason: 'feedback is switched off for this activity' };
    case 'ON':
      return { allowed: true };
    case 'ON_REQUEST':
      return context.requested
        ? { allowed: true }
        : { allowed: false, reason: 'this activity gives feedback only when the student asks' };
    case 'AFTER_FIRST_RESPONSE':
      return context.attemptNumber > 1
        ? { allowed: true }
        : { allowed: false, reason: 'this activity gives feedback only after the first response' };
    case 'AFTER_SUBMISSION':
      return context.submitted
        ? { allowed: true }
        : { allowed: false, reason: 'this activity gives feedback only after submission' };
  }
}

export interface GeneratedFeedback {
  kind: FeedbackKind;
  content: string;
  model: string;
  promptVersion: string;
}

/**
 * Generate feedback for one response.
 *
 * The weakest rubric dimensions steer it, so the feedback is about what the
 * answer actually lacked rather than about the task in general. Earlier
 * attempts are passed in, because telling a student the same thing twice is
 * how adaptive feedback stops being adaptive.
 */
export async function generateFeedback(input: {
  responseText: string;
  activityPrompt?: string | null;
  rubric: RubricForAssessment;
  scores: DimensionScore[];
  priorAttempts?: Array<{ attemptNumber: number; responseText: string }>;
  priorFeedback?: string[];
  model: unknown;
  modelString: string;
  serverManaged?: boolean;
  /** Level 3C: retrieved through the KnowledgeProvider interface. */
  knowledgeContext?: string | null;
  agentRules?: { prohibited?: string | null; style?: string | null } | null;
}): Promise<GeneratedFeedback> {
  const byId = new Map(input.rubric.dimensions.map((d) => [d.dimensionId, d]));
  const weakest = [...input.scores]
    .sort((a, b) => {
      const am = byId.get(a.dimensionId)?.maxScore ?? 1;
      const bm = byId.get(b.dimensionId)?.maxScore ?? 1;
      return a.score / am - b.score / bm;
    })
    .slice(0, 2);

  const system = [
    'You are a tutor giving one short piece of feedback to a university student.',
    'Do not give the answer. Do not score anything. Do not praise emptily.',
    'Aim at the weakest part of what they actually wrote, and leave them',
    'something to do next. Two or three sentences at most.',
    input.agentRules?.style ? `Write in this style: ${input.agentRules.style}` : '',
    input.agentRules?.prohibited ? `You must not: ${input.agentRules.prohibited}` : '',
    input.knowledgeContext
      ? 'Reference material is provided. Point them towards it rather than reciting it, and do not invent material that is not there.'
      : '',
    'Reply with JSON only, no prose and no code fences:',
    '{"kind":"HINT|SOCRATIC_QUESTION|MISCONCEPTION_PROMPT|REQUEST_FOR_EXPLANATION|EXAMPLE|REVIEW_SUGGESTION",',
    ' "content":"..."}',
  ].filter(Boolean).join('\n');

  const prompt = [
    input.activityPrompt ? `TASK:\n${input.activityPrompt}` : '',
    `STUDENT RESPONSE:\n${input.responseText}`,
    weakest.length
      ? `WEAKEST RUBRIC DIMENSIONS:\n${weakest
          .map((s) => {
            const d = byId.get(s.dimensionId);
            return `- ${d?.name ?? s.dimensionId}: ${s.score}/${d?.maxScore ?? '?'}${
              s.evidence ? ` — assessor noted: ${s.evidence}` : ''
            }`;
          })
          .join('\n')}`
      : '',
    input.priorAttempts?.length
      ? `EARLIER ATTEMPTS BY THIS STUDENT:\n${input.priorAttempts
          .map((a) => `attempt ${a.attemptNumber}: ${a.responseText.slice(0, 400)}`)
          .join('\n')}`
      : '',
    input.priorFeedback?.length
      ? `FEEDBACK THEY HAVE ALREADY BEEN GIVEN — do not repeat it:\n${input.priorFeedback
          .map((f) => `- ${f}`)
          .join('\n')}`
      : '',
    input.knowledgeContext ? `REFERENCE MATERIAL:\n${input.knowledgeContext}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await callLLM(
    { model: input.model as never, system, prompt },
    'level3-feedback',
    undefined,
    undefined,
    { serverManaged: input.serverManaged },
  );

  const text = String(result.text ?? '').replace(/^```(?:json)?|```$/gm, '').trim();
  const KINDS: FeedbackKind[] = [
    'HINT', 'SOCRATIC_QUESTION', 'MISCONCEPTION_PROMPT',
    'REQUEST_FOR_EXPLANATION', 'EXAMPLE', 'REVIEW_SUGGESTION',
  ];
  try {
    const parsed = JSON.parse(text) as { kind?: string; content?: string };
    return {
      kind: KINDS.includes(parsed.kind as FeedbackKind) ? (parsed.kind as FeedbackKind) : 'HINT',
      content: typeof parsed.content === 'string' && parsed.content.trim() ? parsed.content.trim() : text,
      model: input.modelString,
      promptVersion: FEEDBACK_PROMPT_VERSION,
    };
  } catch {
    // The model answered in prose. That is still feedback; keep it rather than
    // discarding something a student could use.
    return {
      kind: 'HINT',
      content: text,
      model: input.modelString,
      promptVersion: FEEDBACK_PROMPT_VERSION,
    };
  }
}

/** Every generated piece is recorded, shown or not. */
export async function recordFeedback(
  responseId: string,
  feedback: GeneratedFeedback,
  policy: FeedbackPolicy,
  shown: boolean,
): Promise<string> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `INSERT INTO feedback_events (response_id, kind, content, policy, model, prompt_version, shown_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() ELSE NULL END)
     RETURNING id`,
    [responseId, feedback.kind, feedback.content, policy, feedback.model, feedback.promptVersion, shown],
  );
  return (rows[0] as { id: string }).id;
}
