'use client';
/**
 * Level 2 — Administrator dashboard.
 *
 * The instruction's three groups: USERS (role, institution, status, activate
 * and deactivate, change role), COURSES (all of them, with owner,
 * co-instructors, student count and status), and AUTHORIZATION — assigning and
 * removing instructors, enrolling and removing students.
 *
 * AUTHORIZATION used to be missing here, on the argument that every course
 * route already admits an administrator. That was true of the API and false of
 * the administrator, who had no way to reach it: the only per-course control
 * was a link into the classroom. The instruction asks for the dashboard, not
 * for the permission. It is now the same dialog the instructor uses, opened on
 * any course (S4-4).
 *
 * An administrator cannot change their own role here. The server refuses it
 * too; without that, the last administrator could demote themselves and leave
 * the platform with nobody able to administer it.
 */
import Link from 'next/link';
import { platformClassroomHref } from '@/lib/workbench/classroom-exit';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CourseDialog } from '@/components/level2/course-dialog';
import { ResearchAdmin } from '@/components/level3/research-admin';
import { DeleteCourseButton } from '@/components/level2/delete-course';
import { Input } from '@/components/ui/input';
import { PlatformShell } from '@/components/level2/platform-shell';
import {
  formatWhen,
  useCourses,
  useMe,
  useRoleGuard,
  type CourseSummary,
} from '@/lib/level2/use-platform';

interface PlatformUser {
  id: string;
  email: string;
  displayName: string | null;
  role: 'ADMIN' | 'INSTRUCTOR' | 'STUDENT' | 'RESEARCHER';
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING';
  externalIdentifier: string | null;
  institution: string | null;
  institutionId: string | null;
  institutionShortName: string | null;
  createdAt: string;
}

const ROLES = ['ADMIN', 'INSTRUCTOR', 'STUDENT', 'RESEARCHER'] as const;

type CourseFilter = 'active' | 'published' | 'draft' | 'archived' | 'all';

export default function AdminDashboard() {
  const [managing, setManaging] = useState<CourseSummary | null>(null);
  const [userQuery, setUserQuery] = useState('');
  // The courses table had neither search nor filter while listing every course
  // on the platform — twenty-six of them, eighteen archived, mixed in with the
  // live ones (O7). The Users table above it has had a search box all along.
  const [courseQuery, setCourseQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState<CourseFilter>('active');
  const router = useRouter();
  const me = useMe();
  const { courses, reload: reloadCourses } = useCourses();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [institutions, setInstitutions] = useState<
    Array<{ id: string; name: string; shortName: string | null }>
  >([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (me === null) router.replace('/platform/login');
  }, [me, router]);
  useRoleGuard(me, ['ADMIN']);

  const loadUsers = useCallback(async () => {
    const res = await fetch('/api/level2/admin/users');
    setUsers(res.ok ? (await res.json()).users : []);
  }, []);
  // Fetch on mount: `loadUsers` sets state when the request resolves, which is
  // not the synchronous cascade this rule guards against.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  // The institution selector needs the list; the endpoint is already
  // administrator-readable and refuses students.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/level3/institutions', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { institutions: [] }))
      .then((d) => {
        if (!cancelled) setInstitutions(d.institutions ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(email: string, patch: Record<string, string>, done: string) {
    setMessage(null); // the previous answer is not this request's answer (O3)
    const res = await fetch('/api/level2/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, ...patch }),
    });
    const body = await res.json().catch(() => ({}));
    setMessage(res.ok ? done : (body?.error?.message ?? `Failed (${res.status})`));
    if (res.ok) await loadUsers();
  }

  if (!me) return <main className="p-6 text-sm text-muted-foreground">Loading…</main>;

  const cq = courseQuery.trim().toLowerCase();
  const shownCourses = (courses ?? [])
    .filter((c) =>
      courseFilter === 'all'
        ? true
        : courseFilter === 'active'
          ? c.status !== 'ARCHIVED'
          : courseFilter === 'published'
            ? c.status === 'PUBLISHED'
            : courseFilter === 'draft'
              ? c.status === 'DRAFT'
              : c.status === 'ARCHIVED',
    )
    // An administrator's extra axis is the owner: "whose courses are these?"
    // is the question they arrive with, and it is the one the instructor
    // dashboard never has to answer.
    .filter(
      (c) =>
        !cq ||
        c.title.toLowerCase().includes(cq) ||
        c.stageId.toLowerCase().includes(cq) ||
        c.ownerEmail.toLowerCase().includes(cq),
    );

  const q = userQuery.trim().toLowerCase();
  const shownUsers = users.filter(
    (u) =>
      !q ||
      u.email.toLowerCase().includes(q) ||
      (u.displayName ?? '').toLowerCase().includes(q) ||
      (u.externalIdentifier ?? '').toLowerCase().includes(q) ||
      u.role.toLowerCase() === q,
  );

  const pending = users.filter((u) => u.status === 'PENDING');

  // Four numbers, all computed from what is already loaded. The page opened on
  // a bare table of thirteen accounts and said nothing about the platform as a
  // whole — an administrator had to scroll four screens to learn how much of
  // anything there was (O7).
  const summary = [
    { label: 'Accounts', value: users.length },
    { label: 'Awaiting approval', value: pending.length },
    { label: 'Live courses', value: (courses ?? []).filter((c) => c.status !== 'ARCHIVED').length },
    { label: 'Archived', value: (courses ?? []).filter((c) => c.status === 'ARCHIVED').length },
  ];

  return (
    <PlatformShell me={me} title="Administration">
      {message && <p className="mb-4 text-sm">{message}</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.map((s) => (
          <div key={s.label} className="ring-foreground/10 bg-card rounded-lg px-4 py-3 ring-1">
            <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
            <div className="text-muted-foreground text-xs">{s.label}</div>
          </div>
        ))}
      </div>

      {pending.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pending approval ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pending.map((u) => (
              <div key={u.id} className="flex items-center justify-between text-sm">
                <span>{u.email}</span>
                <div className="flex gap-2">
                  {ROLES.map((role) => (
                    <Button
                      key={role}
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void change(
                          u.email,
                          { role, status: 'ACTIVE' },
                          `Approved ${u.email} as ${role}.`,
                        )
                      }
                    >
                      Approve as {role}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {/* Follows its own search, the way the courses heading does. It used
              to stay at the full count while the rows below it narrowed (F26). */}
            Users ({shownUsers.length}
            {shownUsers.length !== users.length ? ` of ${users.length}` : ''})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Six accounts need no search; two hundred students do (S3-2). */}
          <Input
            className="mb-3 max-w-xs"
            placeholder="Search name, email, student id or role…"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            aria-label="Search users"
          />
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left">
              <tr>
                <th className="py-2">Account</th>
                <th>ID</th>
                <th>Institution</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shownUsers.map((u) => {
                const self = u.id === me.id;
                return (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2">
                      {u.displayName ?? u.email}
                      <br />
                      <span className="text-muted-foreground text-xs">{u.email}</span>
                    </td>
                    <td>{u.externalIdentifier ?? '—'}</td>
                    <td>
                      <select
                        className="bg-background rounded border px-2 py-1 text-sm"
                        value={u.institutionId ?? ''}
                        aria-label={`Institution for ${u.email}`}
                        onChange={(e) =>
                          void change(
                            u.email,
                            { institutionId: e.target.value },
                            e.target.value
                              ? `${u.email} is now in ${
                                  institutions.find((i) => i.id === e.target.value)?.shortName ??
                                  'that institution'
                                }.`
                              : `${u.email} is no longer in an institution.`,
                          )
                        }
                      >
                        <option value="">—</option>
                        {institutions.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.shortName ?? i.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="bg-background rounded border px-2 py-1 text-sm disabled:opacity-50"
                        value={u.role}
                        disabled={self}
                        aria-label={`Role for ${u.email}`}
                        title={self ? 'You cannot change your own role' : undefined}
                        onChange={(e) =>
                          void change(
                            u.email,
                            { role: e.target.value },
                            `${u.email} is now ${e.target.value}.`,
                          )
                        }
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Badge variant={u.status === 'ACTIVE' ? 'default' : 'secondary'}>
                        {u.status}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={self}
                        onClick={() =>
                          void change(
                            u.email,
                            { status: u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
                            `${u.email} ${u.status === 'ACTIVE' ? 'deactivated' : 'activated'}.`,
                          )
                        }
                      >
                        {u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            All courses ({shownCourses.length}
            {courses && shownCourses.length !== courses.length ? ` of ${courses.length}` : ''})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              placeholder="Search by course, id or owner…"
              value={courseQuery}
              onChange={(e) => setCourseQuery(e.target.value)}
              aria-label="Search courses"
            />
            <select
              className="border-input bg-background rounded-md border px-3 text-sm"
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value as CourseFilter)}
              aria-label="Filter courses"
            >
              <option value="active">Active</option>
              <option value="published">Published</option>
              <option value="draft">Drafts</option>
              <option value="archived">Archived</option>
              <option value="all">Everything</option>
            </select>
          </div>
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left">
              <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:whitespace-nowrap">
                <th>Course</th>
                <th>Owner</th>
                <th>Co-instructors</th>
                <th>Students</th>
                <th>Status</th>
                <th>Last activity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shownCourses.map((c) => (
                <tr key={c.id} className="border-b last:border-0 [&>td]:px-2 [&>td]:py-2">
                  <td className="py-2">
                    {c.title}
                    <br />
                    <span className="text-muted-foreground text-xs">{c.stageId}</span>
                  </td>
                  <td>{c.ownerEmail}</td>
                  <td className="text-muted-foreground text-xs">
                    {c.coInstructors?.length ? c.coInstructors.join(', ') : '—'}
                  </td>
                  <td>{c.studentCount}</td>
                  <td>
                    <Badge variant={c.status === 'PUBLISHED' ? 'default' : 'secondary'}>
                      {c.status}
                    </Badge>
                  </td>
                  <td>{formatWhen(c.lastActivityAt)}</td>
                  <td className="space-x-1 text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => setManaging(c)}>
                      Manage
                    </Button>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={platformClassroomHref(c.stageId)}>Open</Link>
                    </Button>
                    <DeleteCourseButton
                      course={c}
                      onDone={(m) => {
                        setMessage(m);
                        reloadCourses();
                      }}
                    />
                  </td>
                </tr>
              ))}
              {courses && shownCourses.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted-foreground py-4">
                    {courses.length === 0
                      ? 'No courses on the platform yet.'
                      : 'No course matches that search and filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {/* Level 3A: institutions and studies are platform administration. */}
      <ResearchAdmin courses={courses} />

      <CourseDialog
        key={managing?.stageId ?? 'none'}
        course={managing}
        tab="students"
        onClose={() => setManaging(null)}
        onChanged={reloadCourses}
      />
    </PlatformShell>
  );
}
