'use client';
/**
 * Level 2 — Student dashboard.
 *
 * The instruction lists what a student must see — title, instructor, status,
 * progress where available, and a way into the classroom — and, at greater
 * length, what they must not: New Course, Generate Course, Pro Workbench,
 * Edit, Delete, course management, other students, provider settings. None of
 * those is rendered here. That is not the protection, though: every one of
 * them is refused server-side as well, because the instruction is explicit
 * that "UI hiding is not security".
 */
import Link from 'next/link';
import { platformClassroomHref } from '@/lib/workbench/classroom-exit';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlatformShell } from '@/components/level2/platform-shell';
import { formatWhen, useCourses, useMe, useRoleGuard, type CourseSummary } from '@/lib/level2/use-platform';

/** What this student has done in one course, as far as they are allowed to see. */
interface MyWork {
  submissions: number;
  lastSubmittedAt: string | null;
  feedbackWaiting: number;
  marked: number;
}

/**
 * The student's own standing in each course.
 *
 * The card used to show *Last activity* and a raw *Course id* — a column for
 * an administrator and an identifier for a support conversation, neither of
 * them an answer to "what do I have to do?" (O8). Level 3 already computes
 * submissions, marking and feedback, and `/api/level3/responses` already
 * returns a student their own rows and nobody else's, so the information was
 * there and simply never reached the person it was about.
 *
 * One request per course, which is two or three on a real roll. A course with
 * no Level-3 activity answers with an empty list and the card says so.
 */
function useMyWork(stageIds: string[]): Record<string, MyWork> {
  const [work, setWork] = useState<Record<string, MyWork>>({});
  const key = stageIds.join(',');
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void Promise.all(
      key.split(',').map(async (stageId) => {
        const res = await fetch(
          `/api/level3/responses?stageId=${encodeURIComponent(stageId)}`,
          { credentials: 'same-origin' },
        ).catch(() => null);
        if (!res?.ok) return null;
        const { responses } = (await res.json()) as {
          responses: Array<{
            submittedAt: string | null;
            feedbackCount: number | string;
            humanAssessments: number | string;
            reviewDecision: string | null;
          }>;
        };
        const summary: MyWork = {
          submissions: responses.length,
          lastSubmittedAt: responses
            .map((r) => r.submittedAt)
            .filter(Boolean)
            .sort()
            .at(-1) ?? null,
          feedbackWaiting: responses.filter((r) => Number(r.feedbackCount) > 0).length,
          // A score only counts as marked once a person stands behind it: a
          // human assessment, or an AI one a human accepted. An unreviewed AI
          // score is never reported here, which is the rule the rest of the
          // platform follows.
          marked: responses.filter(
            (r) => Number(r.humanAssessments) > 0 || r.reviewDecision === 'ACCEPTED',
          ).length,
        };
        return [stageId, summary] as const;
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setWork(Object.fromEntries(pairs.filter((p): p is [string, MyWork] => p !== null)));
    });
    return () => { cancelled = true; };
  }, [key]);
  return work;
}

/**
 * One sentence about this student's standing, in their own terms.
 *
 * Two different things count, and the card used to report only the second: the
 * classroom, which the instructor's Results tab has always shown, and
 * submitted answers, which Level 3 assesses. A student with three sessions and
 * no submission was told "nothing submitted yet" while the next screen over
 * credited them with the work (O22/O23). Both are now here, and the words are
 * a student's — "opened", "answers" — not `runtime_sessions` and
 * `learner_responses`.
 */
function describeWork(work: MyWork | undefined, course: CourseSummary): string {
  if (!work) return 'loading…';
  const visits = Number(course.mySessions ?? 0);
  const parts: string[] = [];

  if (work.submissions > 0) {
    parts.push(work.submissions === 1 ? '1 answer submitted' : `${work.submissions} answers submitted`);
    if (work.marked > 0) parts.push(`${work.marked} marked`);
    parts.push(`last ${formatWhen(work.lastSubmittedAt)}`);
    return parts.join(' · ');
  }

  if (visits === 0) return 'you have not opened this course yet';
  parts.push(visits === 1 ? 'opened once' : `opened ${visits} times`);
  if (course.myLastActivityAt) parts.push(`last ${formatWhen(course.myLastActivityAt)}`);
  parts.push('no answers submitted yet');
  return parts.join(' · ');
}

export default function StudentDashboard() {
  const router = useRouter();
  const me = useMe();
  const { courses } = useCourses();
  const work = useMyWork((courses ?? []).map((c) => c.stageId));

  useEffect(() => {
    if (me === null) router.replace('/platform/login');
  }, [me, router]);
  useRoleGuard(me, ['STUDENT']);

  if (!me) return <main className="p-6 text-sm text-muted-foreground">Loading…</main>;

  return (
    <PlatformShell me={me} title="My courses">
      <h1 className="mb-1 text-xl font-semibold">My courses</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Courses you are enrolled in. {me.externalIdentifier ? `Student ID ${me.externalIdentifier}.` : ''}
      </p>

      {courses === undefined && <p className="text-muted-foreground text-sm">Loading…</p>}
      {courses?.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            You are not enrolled in any published course yet. Your instructor enrols you.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {courses?.map((course) => (
          <Card key={course.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base">{course.title}</CardTitle>
                  {/* Two instructors can each run a "Research Methods", so the
                      id still earns its place — as a quiet second line, not as
                      a labelled row competing with the student's own work. */}
                  <p className="text-muted-foreground mt-0.5 font-mono text-xs">{course.stageId}</p>
                </div>
                <Badge variant="secondary">{course.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="text-muted-foreground space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt>Instructor:</dt>
                  <dd className="text-foreground">{course.ownerName ?? course.ownerEmail}</dd>
                </div>
                <div className="flex gap-2">
                  <dt>Your work:</dt>
                  <dd className="text-foreground">{describeWork(work[course.stageId], course)}</dd>
                </div>
              </dl>
              {work[course.stageId]?.feedbackWaiting ? (
                <p className="text-foreground bg-muted rounded-md px-3 py-2 text-sm">
                  Feedback is waiting on{' '}
                  {work[course.stageId].feedbackWaiting === 1
                    ? 'one of your answers'
                    : `${work[course.stageId].feedbackWaiting} of your answers`}
                  .
                </p>
              ) : null}
              <Button asChild size="sm">
                <Link href={platformClassroomHref(course.stageId)}>Open course</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </PlatformShell>
  );
}
