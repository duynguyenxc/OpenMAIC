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
  const hasStudents = Number(course.studentCount) > 0;

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
              {hasStudents ? (
                <>
                  This course has students on it. If any of them has worked in it, the course is{' '}
                  <strong>archived</strong> rather than deleted: it leaves your list, students can no
                  longer open it, and <strong>none of their work is lost</strong>. You can bring it
                  back from the Archived filter.
                </>
              ) : (
                <>
                  Nobody has worked in this course, so it will be <strong>deleted</strong> along with
                  its enrolments. The lesson itself stays in your OpenMAIC workspace.
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
              {busy ? 'Working…' : hasStudents ? 'Archive it' : 'Delete it'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
