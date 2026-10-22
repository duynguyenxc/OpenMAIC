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
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlatformShell } from '@/components/level2/platform-shell';
import { formatWhen, useCourses, useMe, useRoleGuard } from '@/lib/level2/use-platform';

export default function StudentDashboard() {
  const router = useRouter();
  const me = useMe();
  const { courses } = useCourses();

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
                <CardTitle className="text-base">{course.title}</CardTitle>
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
                  <dt>Last activity:</dt>
                  <dd className="text-foreground">{formatWhen(course.lastActivityAt)}</dd>
                </div>
                {/* Six courses called "Course A" were indistinguishable on
                    this screen; the id is what tells them apart (S3-5). */}
                <div className="flex gap-2">
                  <dt>Course id:</dt>
                  <dd className="text-foreground font-mono text-xs">{course.stageId}</dd>
                </div>
              </dl>
              <Button asChild size="sm">
                <Link href={`/classroom/${course.stageId}`}>Open course</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </PlatformShell>
  );
}
