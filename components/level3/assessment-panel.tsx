'use client';
/**
 * Level 3B — the instructor's assessment surface.
 *
 * Two things an instructor actually needs: a rubric to judge by, and a queue
 * of answers to look at. The second is where the level's rule becomes visible
 * — *"Do NOT overwrite instructor/human ratings"* — because the AI score and
 * the human score are shown **side by side**, and accepting, revising or
 * rejecting records a decision rather than editing a number.
 *
 * Every attempt a student made is listed, not only the last one, because
 * *"Store each version independently"* is pointless if the interface only ever
 * shows the final answer.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatWhen, type CourseSummary } from '@/lib/level2/use-platform';

interface Rubric {
  id: string;
  title: string;
  version: string;
  status: string;
  dimensions: string;
  usedInAssessments: string;
  createdByEmail: string;
}
interface ResponseRow {
  id: string;
  activityId: string;
  attemptNumber: number;
  parentAttemptId: string | null;
  responseText: string;
  submittedAt: string;
  email: string | null;
  studentId: string | null;
  aiAssessments: string;
  humanAssessments: string;
  /** Totals per assessor, so disagreement is visible without opening each one. */
  aiTotal: number | null;
  humanTotal: number | null;
  reviewDecision: string | null;
  feedbackCount: string;
}
interface DimensionScore {
  dimensionId: string;
  score: number;
  evidence: string | null;
  confidence: number | null;
}
interface Scores {
  ai: { assessmentId: string; model: string | null; scores: DimensionScore[] } | null;
  human: { assessmentId: string; scores: DimensionScore[] } | null;
  review: { decision: string; feedback: string | null } | null;
  final: { source: string; scores: DimensionScore[] };
}

/**
 * Did the human and the model reach a different total?
 *
 * Only meaningful once both have scored; one score alone is not a
 * disagreement, and neither is a response nobody has marked.
 */
function disagrees(r: ResponseRow): boolean {
  if (Number(r.aiAssessments) === 0 || Number(r.humanAssessments) === 0) return false;
  if (r.aiTotal === null || r.humanTotal === null) return false;
  return Math.abs(r.humanTotal - r.aiTotal) > 0.001;
}

const POLICIES = ['OFF', 'ON', 'AFTER_FIRST_RESPONSE', 'AFTER_SUBMISSION', 'ON_REQUEST'] as const;
const POLICY_HELP: Record<string, string> = {
  OFF: 'no feedback at all',
  ON: 'whenever it is asked for or generated',
  AFTER_FIRST_RESPONSE: 'only from the second attempt — the first answer stays a clean measurement',
  AFTER_SUBMISSION: 'only once the student has submitted',
  ON_REQUEST: 'only when the student asks',
};

export function AssessmentPanel({ courses }: { courses: CourseSummary[] | undefined }) {
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [course, setCourse] = useState('');
  const [activityId, setActivityId] = useState('sc1');
  const [rubricId, setRubricId] = useState('');
  const [policy, setPolicy] = useState<string>('ON_REQUEST');
  const [responses, setResponses] = useState<ResponseRow[] | null>(null);
  const [openResponse, setOpenResponse] = useState<string | null>(null);
  const [scores, setScores] = useState<Scores | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRubrics = useCallback(() => {
    fetch('/api/level3/rubrics', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { rubrics: [] }))
      .then((d) => setRubrics(d.rubrics));
  }, []);
  useEffect(loadRubrics, [loadRubrics]);

  const loadResponses = useCallback(async (stageId: string) => {
    const r = await fetch(`/api/level3/responses?stageId=${stageId}`, {
      credentials: 'same-origin',
    });
    setResponses(r.ok ? (await r.json()).responses : []);
  }, []);

  async function act(
    url: string,
    init: RequestInit,
    success: (d: Record<string, unknown>) => string,
  ) {
    if (busy) return null;
    setBusy(true);
    setNote(null); // the previous answer is not this request's answer (O3)
    const res = await fetch(url, { credentials: 'same-origin', ...init });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setNote(
      res.ok
        ? success(data)
        : String((data.error as { message?: string } | undefined)?.message ?? 'That did not work.'),
    );
    setBusy(false);
    return res.ok ? data : null;
  }

  const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  async function openScores(responseId: string) {
    setOpenResponse(responseId);
    const r = await fetch(`/api/level3/responses/${responseId}/review`, {
      credentials: 'same-origin',
    });
    setScores(r.ok ? await r.json() : null);
  }

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Rubrics and assessment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {note && (
          <p role="alert" className="bg-muted rounded-md px-3 py-2 text-sm">
            {note}
          </p>
        )}

        {/* ── Attach a rubric and choose when feedback happens ───────────── */}
        <div className="rounded-md border p-3">
          <p className="mb-2 text-sm font-medium">Attach a rubric to an activity</p>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                `/api/level3/courses/${course}/rubric`,
                json({ activityId, rubricId, feedbackPolicy: policy }),
                () =>
                  `“${rubrics.find((r) => r.id === rubricId)?.title}” now judges ${activityId}, with feedback ${POLICY_HELP[policy]}.`,
              );
            }}
          >
            <select
              className="border-input bg-background max-w-xs rounded-md border px-2 py-1 text-sm"
              value={course}
              onChange={(e) => {
                setCourse(e.target.value);
                void loadResponses(e.target.value);
              }}
              aria-label="Course"
            >
              <option value="">Choose a course…</option>
              {(courses ?? []).map((c) => (
                <option key={c.stageId} value={c.stageId}>
                  {c.title}
                </option>
              ))}
            </select>
            <Input
              className="max-w-[8rem]"
              value={activityId}
              onChange={(e) => setActivityId(e.target.value)}
              aria-label="Activity id"
              placeholder="sc1"
            />
            <select
              className="border-input bg-background max-w-xs rounded-md border px-2 py-1 text-sm"
              value={rubricId}
              onChange={(e) => setRubricId(e.target.value)}
              aria-label="Rubric"
            >
              <option value="">Choose a rubric…</option>
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} v{r.version}
                </option>
              ))}
            </select>
            <select
              className="border-input bg-background rounded-md border px-2 py-1 text-sm"
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
              aria-label="Feedback policy"
            >
              {POLICIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Button size="sm" type="submit" disabled={busy || !course || !rubricId}>
              Attach
            </Button>
          </form>
          <p className="text-muted-foreground mt-1 text-xs">Feedback: {POLICY_HELP[policy]}.</p>
        </div>

        {/* ── The queue ─────────────────────────────────────────────────── */}
        {course && (
          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">
                Responses{responses ? ` (${responses.length})` : ''}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void loadResponses(course)}>
                Refresh
              </Button>
            </div>
            {responses && responses.some(disagrees) && (
              <p className="text-muted-foreground px-3 pt-2 text-xs">
                {responses.filter(disagrees).length} of {responses.length} marked answers have a
                human score that differs from the AI&apos;s. Those are the ones worth reading.
              </p>
            )}
            {responses?.length === 0 && (
              <p className="text-muted-foreground px-3 py-4 text-sm">
                No student has answered anything in this course yet.
              </p>
            )}
            {responses?.map((r) => (
              <div key={r.id} className="border-b px-3 py-2 text-sm last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium">{r.email ?? r.studentId ?? 'student'}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {r.activityId} · attempt {r.attemptNumber}
                      {r.parentAttemptId ? ' (a revision)' : ''} · {formatWhen(r.submittedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {Number(r.aiAssessments) > 0 && <Badge variant="secondary">AI scored</Badge>}
                    {Number(r.humanAssessments) > 0 && <Badge>human scored</Badge>}
                    {disagrees(r) && (
                      <Badge variant="destructive">
                        differ by {Math.abs((r.humanTotal ?? 0) - (r.aiTotal ?? 0)).toFixed(1)}
                      </Badge>
                    )}
                    {r.reviewDecision && <Badge variant="outline">{r.reviewDecision}</Badge>}
                    {Number(r.feedbackCount) > 0 && (
                      <Badge variant="outline">{r.feedbackCount} feedback</Badge>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          `/api/level3/responses/${r.id}/assess`,
                          json({}),
                          (d) =>
                            `Assessed with ${String(d.model)}. ${(d.scores as unknown[]).length} dimension(s) scored.`,
                        ).then((d) => {
                          if (d) {
                            void loadResponses(course);
                            void openScores(r.id);
                          }
                        })
                      }
                    >
                      {busy ? 'Working…' : 'Assess with AI'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void openScores(r.id)}>
                      Review
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{r.responseText}</p>

                {openResponse === r.id && scores && (
                  <div className="bg-muted/40 mt-2 space-y-2 rounded-md p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ScoreColumn
                        title="AI"
                        scores={scores.ai?.scores ?? []}
                        subtitle={scores.ai?.model ?? 'not assessed yet'}
                      />
                      <ScoreColumn
                        title="Human"
                        scores={scores.human?.scores ?? []}
                        subtitle={scores.human ? 'instructor' : 'no human score yet'}
                      />
                    </div>
                    <p className="text-xs">
                      <strong>Final:</strong>{' '}
                      {scores.final.source === 'NONE'
                        ? 'none yet — an AI score is not a final score until a human has looked at it'
                        : scores.final.source === 'HUMAN'
                          ? 'the human score'
                          : 'the AI score, accepted by a human'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            `/api/level3/responses/${r.id}/review`,
                            json({ decision: 'ACCEPTED' }),
                            () => 'Accepted the AI assessment.',
                          ).then((d) => {
                            if (d) {
                              void openScores(r.id);
                              void loadResponses(course);
                            }
                          })
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !scores.ai}
                        onClick={() => {
                          const revised = (scores.ai?.scores ?? []).map((s) => ({
                            dimensionId: s.dimensionId,
                            score: Number(
                              prompt(
                                `Your score for ${s.dimensionId} (AI gave ${s.score})`,
                                String(s.score),
                              ) ?? s.score,
                            ),
                          }));
                          void act(
                            `/api/level3/responses/${r.id}/review`,
                            json({ decision: 'REVISED', scores: revised }),
                            () => "Your scores were recorded beside the AI's, which is unchanged.",
                          ).then((d) => {
                            if (d) {
                              void openScores(r.id);
                              void loadResponses(course);
                            }
                          });
                        }}
                      >
                        Revise
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            `/api/level3/responses/${r.id}/review`,
                            json({ decision: 'REJECTED' }),
                            () => 'Rejected. The AI assessment is kept for comparison.',
                          ).then((d) => {
                            if (d) {
                              void openScores(r.id);
                              void loadResponses(course);
                            }
                          })
                        }
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            `/api/level3/responses/${r.id}/feedback`,
                            json({ requested: true }),
                            (d) =>
                              `Feedback generated (${String(d.kind)}): ${String(d.content).slice(0, 120)}…`,
                          ).then((d) => {
                            if (d) void loadResponses(course);
                          })
                        }
                      >
                        Generate feedback
                      </Button>
                    </div>
                    {scores.review?.feedback && (
                      <p className="text-muted-foreground text-xs">
                        Reviewer note: {scores.review.feedback}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          An AI score never replaces a human one and a human score never replaces the AI&apos;s —
          both are kept, which is what makes a later comparison of the two possible.
        </p>
      </CardContent>
    </Card>
  );
}

function ScoreColumn({
  title,
  subtitle,
  scores,
}: {
  title: string;
  subtitle: string;
  scores: DimensionScore[];
}) {
  return (
    <div>
      <p className="text-xs font-medium">
        {title} <span className="text-muted-foreground font-normal">· {subtitle}</span>
      </p>
      {scores.length === 0 && <p className="text-muted-foreground text-xs">—</p>}
      {scores.map((s) => (
        <div key={s.dimensionId} className="text-xs">
          <strong>{s.dimensionId}:</strong> {s.score}
          {s.confidence !== null && s.confidence !== undefined && (
            <span className="text-muted-foreground"> (confidence {s.confidence})</span>
          )}
          {s.evidence && <div className="text-muted-foreground">“{s.evidence}”</div>}
        </div>
      ))}
    </div>
  );
}
