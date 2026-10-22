'use client';
/**
 * Level 2 — removing a course, with the confirmation the act deserves.
 *
 * The platform had no delete at all until 2026-10-21, which is why duplicates
 * accumulated as "(copy) (copy)" and fourteen courses left by automated test
 * runs could not be cleared. The instruction asks for it twice: an
 * administrator "may create/edit/delete any course", an owner "may
 * create/edit/delete own course".
 *
 * The server decides which of two things happens, and this only has to report
 * it honestly: a course nobody has worked in is deleted; a course holding
 * learner sessions is archived instead, because those records are research
 * data and v3 is about a research platform. The wording below says which
 * before the click, so nobody learns the rule by losing something.
 *
 * It used to predict that from the **student count**, which is the wrong
 * question: a course with two students enrolled and nobody having opened it
 * was described as "archived rather than deleted", under a button reading
 * *Archive it*, and was then deleted permanently (O1). Enrolling somebody is
 * not working in something.
 *
 * The right signal is `lastActivityAt`, which is `max(...)` over exactly the
 * `runtime_sessions` rows the server counts — so the two agree by
 * construction. It can only be stale in the safe direction: sessions are never
 * removed, so a course predicted as "will be deleted" can at worst turn out to
 * be archived, and nothing is lost by being wrong that way.
 */
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { CourseSummary } from '@/lib/level2/use-platform';

export function DeleteCourseButton({
  course,
  onDone,
}: {
  course: CourseSummary;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const students = Number(course.studentCount);
  // Worked in, not enrolled on. This is the one the server decides by.
  const willArchive = course.lastActivityAt !== null;

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Delete
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{course.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {willArchive ? (
                <>
                  Students have worked in this course, so it is <strong>archived</strong> rather
                  than deleted: it leaves your list, students can no longer open it, and{' '}
                  <strong>none of their work is lost</strong>. You can bring it back from the
                  Archived filter.
                </>
              ) : (
                <>
                  Nobody has worked in this course, so it will be{' '}
                  <strong>deleted permanently</strong>
                  {students > 0 && (
                    <>
                      , along with {students === 1 ? 'its one enrolment' : `its ${students} enrolments`}
                    </>
                  )}
                  . This cannot be undone. The lesson itself stays in your OpenMAIC workspace.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (event) => {
                event.preventDefault();
                setBusy(true);
                const res = await fetch(`/api/level2/courses/${course.stageId}`, {
                  method: 'DELETE',
                  credentials: 'same-origin',
                  headers: { 'Content-Type': 'application/json' },
                  body: '{}',
                });
                const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
                onDone(
                  res.ok
                    ? data.archived
                      ? String(data.message)
                      : `“${String(data.title)}” was deleted.`
                    : String((data.error as { message?: string } | undefined)?.message ?? 'That did not work.'),
                );
                setBusy(false);
                setOpen(false);
              }}
            >
              {busy ? 'Working…' : willArchive ? 'Archive it' : 'Delete permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
