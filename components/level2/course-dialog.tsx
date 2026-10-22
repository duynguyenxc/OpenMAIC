'use client';
/**
 * Level 2 — everything about one course, in a dialog over the page.
 *
 * It replaces a panel that rendered at the bottom of the document. Clicking
 * "Manage students" on the first card opened it 3,193 px below a viewport
 * 800 px tall, with no scroll and no message, which is indistinguishable from
 * a button that does nothing. Measured on 2026-10-21; see
 * docs/LEVEL2_UPGRADE_PLAN.md S3-1.
 *
 * Three tabs, because the instruction asks for three things about a course and
 * they are all about the same course: who is on it, who teaches it, and what
 * the students did. The middle one had no interface at all — the API existed
 * and was tested, and nothing called it — which is also why an administrator
 * could not perform the authorization work the instruction gives them.
 *
 * The same component serves both: an administrator opens it for any course,
 * an instructor for their own. Neither gets a privilege from opening it; every
 * action inside goes through the same server checks as before.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatWhen, type CourseSummary } from '@/lib/level2/use-platform';

type Tab = 'students' | 'team' | 'results';

interface Student {
  email: string;
  displayName: string | null;
  externalIdentifier: string | null;
  status: string;
}
interface CoInstructor {
  email: string;
  displayName: string | null;
  permission: 'OWNER' | 'EDITOR' | 'VIEWER';
}
interface ResultRow {
  email: string;
  externalIdentifier: string | null;
  sessions: number;
  /** `runtime_records` for this learner. The UI used to read `interactions`,
   *  which no route has ever returned, so the line said "· interactions ·"
   *  with nothing in front of it (O11). */
  records: number;
  activityTypes: string[] | null;
  lastActivityAt: string | null;
}
interface TrajectoryEvent {
  /** The route returns `createdAt`. This interface said `timestamp`, so every
   *  row in the trajectory rendered its time as "—" (O21) — the same mistake
   *  as `interactions` against `records` in F14. */
  createdAt: string | null;
  sessionStartedAt: string | null;
  sessionOnly: boolean;
  sessionKind: string | null;
  activityType: string | null;
  activityId: string | null;
  learnerInput: string | null;
  agentResponse: string | null;
}

/** Reads the server's own words rather than inventing a friendlier lie. */
async function send(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; message: string; data: Record<string, unknown> }> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { ok: true, message: '', data };
  const error = data.error as { message?: string } | undefined;
  return { ok: false, message: error?.message ?? `request failed (${res.status})`, data };
}

export function CourseDialog({
  course,
  tab,
  onClose,
  onChanged,
}: {
  course: CourseSummary | null;
  tab: Tab;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [active, setActive] = useState<Tab>(tab);
  const [students, setStudents] = useState<Student[] | null>(null);
  const [team, setTeam] = useState<CoInstructor[] | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [trajectory, setTrajectory] = useState<{ email: string; events: TrajectoryEvent[] } | null>(
    null,
  );
  const [note, setNote] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [studentEmail, setStudentEmail] = useState('');
  const [teamEmail, setTeamEmail] = useState('');
  const [teamPermission, setTeamPermission] = useState<'EDITOR' | 'VIEWER'>('EDITOR');

  useEffect(() => setActive(tab), [tab]);

  const stageId = course?.stageId;

  const load = useCallback(async () => {
    if (!stageId) return;
    const [s, t, r] = await Promise.all([
      fetch(`/api/level2/courses/${stageId}/enrollments`, { credentials: 'same-origin' }),
      fetch(`/api/level2/courses/${stageId}/instructors`, { credentials: 'same-origin' }),
      fetch(`/api/level2/courses/${stageId}/results`, { credentials: 'same-origin' }),
    ]);
    setStudents(s.ok ? ((await s.json()).students as Student[]) : []);
    setTeam(t.ok ? ((await t.json()).instructors as CoInstructor[]) : []);
    setResults(r.ok ? ((await r.json()).students as ResultRow[]) : []);
  }, [stageId]);

  useEffect(() => {
    if (!stageId) return;
    setNote(null);
    setTrajectory(null);
    void load();
  }, [stageId, load]);

  if (!course) return null;

  /** Every action reports what the server said, and nothing is enabled twice. */
  async function act(url: string, init: RequestInit, success: (d: Record<string, unknown>) => string) {
    if (busy) return;
    setBusy(true);
    setNote(null); // the previous answer is not this request's answer (O3)
    const outcome = await send(url, init);
    setNote({ kind: outcome.ok ? 'ok' : 'bad', text: outcome.ok ? success(outcome.data) : outcome.message });
    if (outcome.ok) {
      await load();
      onChanged();
    }
    setBusy(false);
  }

  const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return (
    <Dialog open={Boolean(course)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8">{course.title}</DialogTitle>
          <DialogDescription>
            {course.status} · {course.stageId} · created {formatWhen(course.createdAt)}
          </DialogDescription>
        </DialogHeader>

        {/* Always occupies its row. Collapsing it moved the tab strip and
            everything under it by about 18 px whenever a message appeared or
            cleared, so a click aimed at a tab missed (O4). */}
        <div className="min-h-9">
          {note && (
            <p
              role="alert"
              className={`rounded-md px-3 py-2 text-sm ${
                note.kind === 'ok'
                  ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
                  : 'bg-destructive/10 text-destructive'
              }`}
            >
              {note.text}
            </p>
          )}
        </div>

        <Tabs value={active} onValueChange={(v) => setActive(v as Tab)}>
          <TabsList>
            <TabsTrigger value="students">
              Students
              {students
                ? (() => {
                    const active = students.filter((s) => s.status === 'ACTIVE').length;
                    const inactive = students.length - active;
                    return inactive > 0 ? ` (${active}, ${inactive} inactive)` : ` (${active})`;
                  })()
                : ''}
            </TabsTrigger>
            <TabsTrigger value="team">Teaching team{team ? ` (${team.length})` : ''}</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
          </TabsList>

          {/* ───────────── Students ───────────── */}
          <TabsContent value="students" className="space-y-3 pt-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  `/api/level2/courses/${course.stageId}/enrollments`,
                  json({ email: studentEmail }),
                  (d) => {
                    setStudentEmail('');
                    return d.outcome === 'already-enrolled'
                      ? `${d.enrolled} was already on this course.`
                      : d.outcome === 'reactivated'
                        ? `${d.enrolled} was brought back onto the course.`
                        : `${d.enrolled} is now enrolled.`;
                  },
                );
              }}
            >
              <Input
                type="email"
                placeholder="student@example.test"
                value={studentEmail}
                onChange={(e) => setStudentEmail(e.target.value)}
                aria-label="Student email to enrol"
              />
              <Button type="submit" disabled={busy || !studentEmail.trim()}>
                {busy ? 'Working…' : 'Add student'}
              </Button>
            </form>

            {students?.length === 0 && (
              <p className="text-muted-foreground py-6 text-center text-sm">
                Nobody is enrolled yet. Add a student by their email address above.
              </p>
            )}
            {students?.map((s) => (
              <div key={s.email} className="flex items-center justify-between border-b py-2 text-sm">
                <div>
                  <div>{s.displayName ?? s.email}</div>
                  <div className="text-muted-foreground text-xs">
                    {s.email}
                    {s.externalIdentifier ? ` · ${s.externalIdentifier}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={s.status === 'ACTIVE' ? 'default' : 'secondary'}>{s.status}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      s.status === 'ACTIVE'
                        ? void act(
                            `/api/level2/courses/${course.stageId}/enrollments?email=${encodeURIComponent(s.email)}`,
                            { method: 'DELETE' },
                            () => `${s.email} can no longer open this course. Their work is kept.`,
                          )
                        : void act(
                            `/api/level2/courses/${course.stageId}/enrollments`,
                            json({ email: s.email }),
                            () => `${s.email} was brought back onto the course.`,
                          )
                    }
                  >
                    {s.status === 'ACTIVE' ? 'Remove' : 'Restore'}
                  </Button>
                </div>
              </div>
            ))}
          </TabsContent>

          {/* ───────────── Teaching team ───────────── */}
          <TabsContent value="team" className="space-y-3 pt-3">
            <p className="text-muted-foreground text-sm">
              An <strong>editor</strong> can change the course and see its students. A{' '}
              <strong>viewer</strong> can only read. Only the owner can enrol students, publish, or
              delete.
            </p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  `/api/level2/courses/${course.stageId}/instructors`,
                  json({ email: teamEmail, permission: teamPermission }),
                  (d) => {
                    setTeamEmail('');
                    return `${d.email} can now work on this course as ${String(d.permission).toLowerCase()}.`;
                  },
                );
              }}
            >
              <Input
                type="email"
                placeholder="colleague@example.test"
                value={teamEmail}
                onChange={(e) => setTeamEmail(e.target.value)}
                aria-label="Co-instructor email"
              />
              <select
                className="border-input bg-background rounded-md border px-3 text-sm"
                value={teamPermission}
                onChange={(e) => setTeamPermission(e.target.value as 'EDITOR' | 'VIEWER')}
                aria-label="Permission for the co-instructor"
              >
                <option value="EDITOR">Editor</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <Button type="submit" disabled={busy || !teamEmail.trim()}>
                {busy ? 'Working…' : 'Add'}
              </Button>
            </form>

            {team?.map((t) => (
              <div key={t.email} className="flex items-center justify-between border-b py-2 text-sm">
                <div>
                  <div>{t.displayName ?? t.email}</div>
                  <div className="text-muted-foreground text-xs">{t.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  {t.permission === 'OWNER' ? (
                    <>
                      <Badge>OWNER</Badge>
                      <span className="text-muted-foreground text-xs">owner</span>
                    </>
                  ) : (
                    <select
                      className="border-input bg-background rounded-md border px-2 py-1 text-xs"
                      value={t.permission}
                      disabled={busy}
                      onChange={(e) =>
                        void act(
                          `/api/level2/courses/${course.stageId}/instructors`,
                          json({ email: t.email, permission: e.target.value }),
                          (d) =>
                            `${d.email} is now ${String(d.permission).toLowerCase()} on this course.`,
                        )
                      }
                      aria-label={`Permission for ${t.email}`}
                    >
                      <option value="EDITOR">Editor</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                  )}
                  {t.permission !== 'OWNER' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          `/api/level2/courses/${course.stageId}/instructors?email=${encodeURIComponent(t.email)}`,
                          { method: 'DELETE' },
                          () => `${t.email} can no longer reach this course.`,
                        )
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </TabsContent>

          {/* ───────────── Results ───────────── */}
          <TabsContent value="results" className="space-y-3 pt-3">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/level2/courses/${course.stageId}/export?format=csv`}>Export CSV</a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/level2/courses/${course.stageId}/export?format=json`}>Export JSON</a>
              </Button>
            </div>

            {results?.length === 0 && (
              <p className="text-muted-foreground py-6 text-center text-sm">
                Nobody is enrolled yet, so there is nothing to report.
              </p>
            )}
            {results?.map((r) => (
              <div key={r.email} className="flex items-center justify-between border-b py-2 text-sm">
                <div>
                  <div>{r.email}</div>
                  <div className="text-muted-foreground text-xs">
                    {r.externalIdentifier ?? '—'} · {r.sessions} session
                    {Number(r.sessions) === 1 ? '' : 's'} · {Number(r.records ?? 0)} record
                    {Number(r.records ?? 0) === 1 ? '' : 's'} · last {formatWhen(r.lastActivityAt)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    const res = await fetch(
                      `/api/level2/courses/${course.stageId}/results?email=${encodeURIComponent(r.email)}`,
                      { credentials: 'same-origin' },
                    );
                    if (!res.ok) {
                      setNote({ kind: 'bad', text: 'That student is not on this course.' });
                      return;
                    }
                    setTrajectory(await res.json());
                  }}
                >
                  View trajectory
                </Button>
              </div>
            ))}

            {trajectory && (
              <div className="bg-muted/40 mt-3 rounded-md p-3">
                <div className="mb-2 flex items-center justify-between">
                  <strong className="text-sm">{trajectory.email}</strong>
                  <Button size="sm" variant="ghost" onClick={() => setTrajectory(null)}>
                    Close
                  </Button>
                </div>
                {trajectory.events.length === 0 && (
                  <p className="text-muted-foreground text-sm">
                    This student has not worked in the course yet.
                  </p>
                )}
                {trajectory.events.map((e, i) => (
                  <div key={i} className="border-b py-2 text-sm last:border-0">
                    <div className="text-muted-foreground text-xs">
                      {formatWhen(e.sessionOnly ? e.sessionStartedAt : e.createdAt)} ·{' '}
                      {e.sessionOnly
                        ? `opened a ${e.sessionKind ?? 'session'}, nothing recorded`
                        : (e.activityType ?? 'event')}
                      {e.activityId ? ` · ${e.activityId}` : ''}
                    </div>
                    {e.learnerInput && <p className="mt-1">🧑 {e.learnerInput}</p>}
                    {e.agentResponse && <p className="mt-1">🤖 {e.agentResponse}</p>}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
