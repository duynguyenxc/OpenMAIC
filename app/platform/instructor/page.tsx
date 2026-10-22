'use client';
/**
 * Level 2 — Instructor dashboard.
 *
 * Rewritten on 2026-10-21 against docs/LEVEL2_UPGRADE_PLAN.md. What the
 * earlier version got wrong, all measured rather than felt:
 *
 * - eleven courses made a page four screens tall with 57 buttons on it, and
 *   there was no search, filter or sort to cut it down (S3-2);
 * - the entry point to making a course rendered *only while the list was
 *   empty*, so an instructor with one course could not make a second (S4-2);
 * - a course could not be renamed or deleted from anywhere in the product
 *   (S4-3, S4-1), which is why copies accumulated as "(copy) (copy)";
 * - clicking a button opened its panel three screens further down (S3-1).
 *
 * So: one compact row per course, the controls that act on a course behind its
 * own menu, and everything about a course in a dialog over the page.
 */
import Link from 'next/link';
import { platformClassroomHref } from '@/lib/workbench/classroom-exit';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CourseDialog } from '@/components/level2/course-dialog';
import { DeleteCourseButton } from '@/components/level2/delete-course';
import { PlatformShell } from '@/components/level2/platform-shell';
import { TemplateLibrary } from '@/components/level3/template-library';
import { AssessmentPanel } from '@/components/level3/assessment-panel';
import { KnowledgePanel } from '@/components/level3/knowledge-panel';
import { formatWhen, useCourses, useMe, useRoleGuard, type CourseSummary } from '@/lib/level2/use-platform';

type Filter = 'active' | 'published' | 'draft' | 'archived';
type Sort = 'activity' | 'title' | 'created';

export default function InstructorDashboard() {
  const me = useMe();
  // An administrator may open a course's management dialog from here too.
  useRoleGuard(me, ['INSTRUCTOR', 'ADMIN']);
  const { courses, reload } = useCourses();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [sort, setSort] = useState<Sort>('activity');
  const [open, setOpen] = useState<{ course: CourseSummary; tab: 'students' | 'team' | 'results' } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    if (!courses) return [];
    const q = query.trim().toLowerCase();
    return courses
      .filter((c) =>
        filter === 'active' ? c.status !== 'ARCHIVED'
        : filter === 'published' ? c.status === 'PUBLISHED'
        : filter === 'draft' ? c.status === 'DRAFT'
        : c.status === 'ARCHIVED',
      )
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.stageId.toLowerCase().includes(q))
      .sort((a, b) =>
        sort === 'title' ? a.title.localeCompare(b.title)
        : sort === 'created' ? (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
        : (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''),
      );
  }, [courses, query, filter, sort]);

  if (me === undefined) return <LoadingScreen />;
  if (me === null) return null;

  /**
   * Returns whether the server accepted it, so a caller can keep an editor
   * open when it did not (O2) — the rename used to close and revert on every
   * answer, so a refused long title had to be typed again from nothing.
   */
  async function change(stageId: string, body: Record<string, unknown>, success: string) {
    if (busy) return false;
    setBusy(true);
    // Clear first. The previous answer stayed on screen for the whole round
    // trip, so a second attempt was read against the first attempt's error
    // (O3) — "a course title cannot be empty" about a title that was not.
    setNote(null);
    const res = await fetch(`/api/level2/courses/${stageId}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    setNote(res.ok ? success : (data.error?.message ?? 'That did not work.'));
    if (res.ok) reload();
    setBusy(false);
    return res.ok;
  }

  return (
    <PlatformShell me={me} title="My courses">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* True for an instructor; false for an administrator, who is shown
              every course on the platform under the same two lines (O17). */}
          <h1 className="text-xl font-semibold">
            {me.role === 'ADMIN' ? 'All courses' : 'My courses'}
          </h1>
          <p className="text-muted-foreground text-sm">
            {me.role === 'ADMIN'
              ? 'Every course on the platform. You are seeing this as an administrator.'
              : 'Courses you own or have been given access to.'}
          </p>
        </div>
        {/* Permanent, not only while the list is empty. */}
        <Button asChild>
          <Link href="/">+ New course</Link>
        </Button>
      </div>

      {/* Always occupies its row. It used to collapse when empty, which moved
          the toolbar and the whole course list up and down by about 18 px as
          messages came and went — a click aimed at a tab landed on nothing
          (O4). */}
      <div className="mb-3 min-h-9">
        {note && (
          <p role="alert" className="bg-muted rounded-md px-3 py-2 text-sm">
            {note}
          </p>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search by name or id…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search courses"
        />
        <select
          className="border-input bg-background rounded-md border px-3 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          aria-label="Filter courses"
        >
          <option value="active">Active</option>
          <option value="published">Published</option>
          <option value="draft">Drafts</option>
          <option value="archived">Archived</option>
        </select>
        <select
          className="border-input bg-background rounded-md border px-3 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort courses"
        >
          <option value="activity">Last activity</option>
          <option value="created">Newest</option>
          <option value="title">Name</option>
        </select>
      </div>

      {courses === undefined && <p className="text-muted-foreground text-sm">Loading your courses…</p>}

      {courses && shown.length === 0 && (
        <div className="rounded-lg border py-10 text-center">
          <p className="text-muted-foreground text-sm">
            {courses.length === 0
              ? 'You have no courses yet. Make one in the OpenMAIC workspace and it becomes yours automatically.'
              : 'No course matches what you typed.'}
          </p>
          {courses.length === 0 && (
            <Button className="mt-3" asChild>
              <Link href="/">Open the workspace</Link>
            </Button>
          )}
        </div>
      )}

      <div className="divide-y rounded-lg border">
        {shown.map((c) => (
          <div key={c.stageId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              {renaming === c.stageId ? (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void change(c.stageId, { title: draftTitle }, `Renamed to “${draftTitle.trim()}”.`).then(
                      (ok) => { if (ok) setRenaming(null); },
                    );
                  }}
                >
                  <Input
                    autoFocus
                    maxLength={200}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    aria-label="New course name"
                  />
                  <Button size="sm" type="submit" disabled={busy}>Save</Button>
                  <Button size="sm" type="button" variant="ghost" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <div className="truncate font-medium">{c.title}</div>
                  {/* The id and the date are what tell six courses called
                      "Course A" apart (S3-5). */}
                  <div className="text-muted-foreground truncate text-xs">
                    {c.stageId} · {c.studentCount} student{Number(c.studentCount) === 1 ? '' : 's'} ·
                    last activity {formatWhen(c.lastActivityAt)}
                  </div>
                </>
              )}
            </div>

            <Badge variant={c.status === 'PUBLISHED' ? 'default' : 'secondary'}>{c.status}</Badge>

            <div className="flex flex-wrap items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => setOpen({ course: c, tab: 'students' })}>
                Students
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpen({ course: c, tab: 'results' })}>
                Results
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={platformClassroomHref(c.stageId)}>Open</Link>
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link href={`/workspace?stage=${c.stageId}`}>Edit</Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setRenaming(c.stageId);
                  setDraftTitle(c.title);
                }}
              >
                Rename
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void change(
                    c.stageId,
                    { status: c.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED' },
                    c.status === 'PUBLISHED'
                      ? 'Unpublished. Students can no longer open it.'
                      : 'Published. Enrolled students can open it now.',
                  )
                }
              >
                {c.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
              </Button>
              <DuplicateButton course={c} onDone={(m) => { setNote(m); reload(); }} />
              <DeleteCourseButton course={c} onDone={(m) => { setNote(m); reload(); }} />
            </div>
          </div>
        ))}
      </div>

      {/* Level 3A: publish a module, or run somebody else's. */}
      <TemplateLibrary courses={courses} onChanged={reload} />

      {/* Level 3B: rubrics, AI assessment, human review, feedback. */}
      <AssessmentPanel courses={courses} />

      {/* Level 3C: knowledge sources, retrieval, bounded agents. */}
      <KnowledgePanel courses={courses} />

      <CourseDialog
        course={open?.course ?? null}
        tab={open?.tab ?? 'students'}
        onClose={() => setOpen(null)}
        onChanged={reload}
      />
    </PlatformShell>
  );
}

/** Disabled while in flight: two clicks used to make two courses (S1-2). */
function DuplicateButton({ course, onDone }: { course: CourseSummary; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await fetch(`/api/level2/courses/${course.stageId}/duplicate`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `${course.title} (copy)` }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        onDone(
          res.ok
            ? data.deduplicated
              ? 'That copy had already been made a moment ago.'
              : `Copied as “${String(data.title)}”. It starts as a draft with no students.`
            : String((data.error as { message?: string } | undefined)?.message ?? 'Copy failed.'),
        );
        setBusy(false);
      }}
    >
      {busy ? 'Copying…' : 'Duplicate'}
    </Button>
  );
}

export function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground text-sm">Loading…</p>
    </main>
  );
}
