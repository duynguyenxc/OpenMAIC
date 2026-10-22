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
import { formatWhen, useCourses, useMe, useRoleGuard } from '@/lib/level2/use-platform';

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

/** One sentence about this student's standing, or an honest absence of one. */
function describeWork(work: MyWork | undefined): string {
  if (!work) return 'loading…';
  // Not "nothing yet": this counts `learner_responses` only, and a student who
  // has spent an hour in the classroom has runtime records but no submitted
  // answer. The instructor's Results tab shows that activity, so a card
  // claiming the student had done nothing contradicted it (O22).
  if (work.submissions === 0) return 'no answers submitted yet';
  const parts = [
    work.submissions === 1 ? '1 submission' : `${work.submissions} submissions`,
  ];
  if (work.marked > 0) parts.push(`${work.marked} marked`);
  if (work.lastSubmittedAt) parts.push(`last ${formatWhen(work.lastSubmittedAt)}`);
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
                  <dd className="text-foreground">{describeWork(work[course.stageId])}</dd>
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
