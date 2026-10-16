'use client';
/**
 * Level 2 — Instructor dashboard.
 *
 * Covers the three groups the instruction names: the course list with title,
 * status, student count, co-instructors and last activity; MANAGE STUDENTS
 * (add, remove, reactivate); and COURSE RESULTS, including selecting one
 * enrolled student and reading their trajectory out of OpenMAIC's runtime
 * store. Export is CSV and JSON.
 *
 * Everything here calls an API that authorizes independently, so a course this
 * instructor is not entitled to is refused even if a request is made by hand.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PlatformShell } from '@/components/level2/platform-shell';
import { formatWhen, useCourses, useMe, type CourseSummary } from '@/lib/level2/use-platform';

interface EnrolledStudent {
  id: string; email: string; displayName: string | null;
  externalIdentifier: string | null; status: string; enrolledAt: string;
}
interface ResultRow {
  email: string; displayName: string | null; externalIdentifier: string | null;
  enrollmentStatus: string; sessions: number; records: number;
  lastActivityAt: string | null; kinds: string[];
}
interface TrajectoryEvent {
  activityType: string | null; activityId: string | null;
  learnerInput: string | null; agentResponse: string | null;
  seq: number | null; createdAt: string | null;
}

type Panel = 'students' | 'results';

export default function InstructorDashboard() {
  const router = useRouter();
  const me = useMe();
  const { courses, reload } = useCourses();
  const [selected, setSelected] = useState<CourseSummary | null>(null);
  const [panel, setPanel] = useState<Panel>('students');
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [trajectory, setTrajectory] = useState<{ email: string; events: TrajectoryEvent[] } | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { if (me === null) router.replace('/platform/login'); }, [me, router]);

  const loadStudents = useCallback(async (stageId: string) => {
    const res = await fetch(`/api/level2/courses/${stageId}/enrollments`);
    setStudents(res.ok ? (await res.json()).students : []);
  }, []);

  const loadResults = useCallback(async (stageId: string) => {
    const res = await fetch(`/api/level2/courses/${stageId}/results`);
    setResults(res.ok ? (await res.json()).students : []);
  }, []);

  function open(course: CourseSummary, which: Panel) {
    setSelected(course); setPanel(which); setTrajectory(null); setMessage(null);
    void (which === 'students' ? loadStudents(course.stageId) : loadResults(course.stageId));
  }

  async function act(path: string, init: RequestInit, done: string) {
    const res = await fetch(path, init);
    const body = await res.json().catch(() => ({}));
    setMessage(res.ok ? done : (body?.error?.message ?? `Failed (${res.status})`));
    if (res.ok && selected) { await loadStudents(selected.stageId); reload(); }
  }

  if (!me) return <main className="p-6 text-sm text-muted-foreground">Loading…</main>;

  return (
    <PlatformShell me={me}>
      <h1 className="mb-1 text-xl font-semibold">My courses</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Courses you own or have been given access to.
      </p>

      {courses?.length === 0 && (
        <Card><CardContent className="text-muted-foreground py-8 text-center text-sm">
          No courses yet. Create one in the OpenMAIC workspace; it becomes yours automatically.
          <div className="mt-3"><Button asChild size="sm"><Link href="/">Open workspace</Link></Button></div>
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {courses?.map((course) => (
          <Card key={course.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{course.title}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={course.status === 'PUBLISHED' ? 'default' : 'secondary'}>
                    {course.status}
                  </Badge>
                  <Button size="sm" variant="outline"
                    onClick={() => void act(
                      `/api/level2/courses/${course.stageId}`,
                      { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: course.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED' }) },
                      course.status === 'PUBLISHED' ? 'Unpublished.' : 'Published.',
                    )}>
                    {course.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-muted-foreground grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <span>Students: <span className="text-foreground">{course.studentCount}</span></span>
                <span>Last activity: <span className="text-foreground">{formatWhen(course.lastActivityAt)}</span></span>
                <span className="sm:col-span-2">
                  Co-instructors:{' '}
                  <span className="text-foreground">
                    {course.coInstructors?.length ? course.coInstructors.join(', ') : 'none'}
                  </span>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline"><Link href={`/workspace?stage=${course.stageId}`}>Edit</Link></Button>
                <Button asChild size="sm" variant="outline"><Link href={`/classroom/${course.stageId}`}>Open classroom</Link></Button>
                <Button size="sm" variant="outline" onClick={() => open(course, 'students')}>Manage students</Button>
                <Button size="sm" variant="outline" onClick={() => open(course, 'results')}>Results</Button>
                <Button size="sm" variant="ghost" onClick={async () => {
                  const res = await fetch(`/api/level2/courses/${course.stageId}/duplicate`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: `${course.title} (copy)` }),
                  });
                  const body = await res.json().catch(() => ({}));
                  setMessage(res.ok
                    ? `Duplicated as "${body.title}". The copy starts as a draft with no students and no learner data.`
                    : (body?.error?.message ?? `Failed (${res.status})`));
                  if (res.ok) reload();
                }}>Duplicate</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {selected && (
        <Card className="mt-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {panel === 'students' ? 'Manage students' : 'Course results'} — {selected.title}
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {message && <p className="text-sm">{message}</p>}

            {panel === 'students' && (
              <>
                <form className="flex gap-2" onSubmit={(e) => {
                  e.preventDefault();
                  void act(`/api/level2/courses/${selected.stageId}/enrollments`,
                    { method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: newEmail.trim() }) },
                    `Enrolled ${newEmail.trim()}.`);
                  setNewEmail('');
                }}>
                  <Input placeholder="student@example.test" value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)} />
                  <Button type="submit" size="sm">Add student</Button>
                </form>
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground border-b text-left">
                    <tr><th className="py-2">Student</th><th>ID</th><th>Status</th><th /></tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="py-2">{s.displayName ?? s.email}<br />
                          <span className="text-muted-foreground text-xs">{s.email}</span></td>
                        <td>{s.externalIdentifier ?? '—'}</td>
                        <td><Badge variant={s.status === 'ACTIVE' ? 'default' : 'secondary'}>{s.status}</Badge></td>
                        <td className="text-right">
                          {s.status === 'ACTIVE' ? (
                            <Button size="sm" variant="outline" onClick={() => void act(
                              `/api/level2/courses/${selected.stageId}/enrollments?email=${encodeURIComponent(s.email)}`,
                              { method: 'DELETE' }, `Deactivated ${s.email}.`)}>Deactivate</Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => void act(
                              `/api/level2/courses/${selected.stageId}/enrollments`,
                              { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ email: s.email }) }, `Reactivated ${s.email}.`)}>Reactivate</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {students.length === 0 && (
                      <tr><td colSpan={4} className="text-muted-foreground py-4">No students enrolled.</td></tr>
                    )}
                  </tbody>
                </table>
              </>
            )}

            {panel === 'results' && (
              <>
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/level2/courses/${selected.stageId}/export?format=csv`}>Export CSV</a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/level2/courses/${selected.stageId}/export?format=json`}>Export JSON</a>
                  </Button>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground border-b text-left">
                    <tr><th className="py-2">Student</th><th>Sessions</th><th>Interactions</th>
                      <th>Activity types</th><th>Last activity</th><th /></tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.email} className="border-b last:border-0">
                        <td className="py-2">{r.displayName ?? r.email}<br />
                          <span className="text-muted-foreground text-xs">{r.externalIdentifier ?? r.email}</span></td>
                        <td>{r.sessions}</td>
                        <td>{r.records}</td>
                        <td className="text-muted-foreground text-xs">{r.kinds?.length ? r.kinds.join(', ') : '—'}</td>
                        <td>{formatWhen(r.lastActivityAt)}</td>
                        <td className="text-right">
                          <Button size="sm" variant="ghost" onClick={async () => {
                            const res = await fetch(
                              `/api/level2/courses/${selected.stageId}/results?email=${encodeURIComponent(r.email)}`);
                            setTrajectory(res.ok ? await res.json() : null);
                          }}>View trajectory</Button>
                        </td>
                      </tr>
                    ))}
                    {results.length === 0 && (
                      <tr><td colSpan={6} className="text-muted-foreground py-4">No enrolled students yet.</td></tr>
                    )}
                  </tbody>
                </table>

                {trajectory && (
                  <div className="rounded-md border p-3">
                    <p className="mb-2 text-sm font-medium">Trajectory — {trajectory.email}</p>
                    {trajectory.events.length === 0 && (
                      <p className="text-muted-foreground text-sm">No interaction recorded yet.</p>
                    )}
                    <ol className="space-y-2">
                      {trajectory.events.map((e, i) => (
                        <li key={i} className="text-sm">
                          <span className="text-muted-foreground text-xs">
                            {formatWhen(e.createdAt)} · {e.activityType ?? 'event'}
                            {e.activityId ? ` · ${e.activityId}` : ''}
                          </span>
                          {e.learnerInput && <p className="mt-0.5"><b>Student:</b> {e.learnerInput}</p>}
                          {e.agentResponse && <p className="mt-0.5"><b>AI:</b> {e.agentResponse}</p>}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </PlatformShell>
  );
}
