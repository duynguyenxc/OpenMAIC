'use client';
/** Level 2 — shared client state for the dashboards. */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

export interface Me {
  id: string;
  email: string;
  displayName: string | null;
  role: 'ADMIN' | 'INSTRUCTOR' | 'STUDENT' | 'RESEARCHER';
  externalIdentifier: string | null;
  institution: string | null;
  status: string;
}

export interface CourseSummary {
  id: string;
  stageId: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  createdAt: string;
  ownerEmail: string;
  ownerName: string | null;
  studentCount: string | number;
  coInstructorCount: string | number;
  coInstructors: string[] | null;
  lastActivityAt: string | null;
  /** A student's own standing in the course. Absent for other roles (O23). */
  mySessions?: string | number | null;
  myRecords?: string | number | null;
  myLastActivityAt?: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

/** The signed-in account, or null when the request is not authenticated. */
export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    getJson<Me>('/api/level2/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  return me;
}

/** The one page each role lands on. Matches the first link in the shell's nav. */
export function homeFor(role: Me['role']): string {
  if (role === 'ADMIN') return '/platform/admin';
  if (role === 'INSTRUCTOR') return '/platform/instructor';
  if (role === 'RESEARCHER') return '/platform/researcher';
  return '/platform/student';
}

/**
 * Send a signed-in account to its own dashboard when it opens somebody else's.
 *
 * Not security — every route behind these pages refuses the wrong role on the
 * server, and a student who asked for the instructor console used to get all
 * 403s from a page that still drew Rename, Unpublish and Delete on their
 * teacher's courses, with panels reading "Nobody is enrolled yet" because the
 * reads had been refused. Nothing leaked; the page simply lied. This decides
 * the question before any of that is drawn.
 *
 * `undefined` means the identity is still loading and nothing is decided yet;
 * `null` means signed out, which each page already sends to the login screen.
 */
export function useRoleGuard(me: Me | null | undefined, allowed: Me['role'][]): void {
  const router = useRouter();
  useEffect(() => {
    if (!me) return;
    if (!allowed.includes(me.role)) router.replace(homeFor(me.role));
    // `allowed` is a literal at every call site; joining it keeps the effect
    // from re-running on each render over a new array identity.
  }, [me, allowed.join(','), router]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useCourses() {
  const [courses, setCourses] = useState<CourseSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    getJson<{ courses: CourseSummary[] }>('/api/level2/courses')
      .then((data) => setCourses(data.courses))
      .catch((cause: Error) => setError(cause.message));
  }, []);
  useEffect(reload, [reload]);
  return { courses, error, reload };
}

export function formatWhen(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}
