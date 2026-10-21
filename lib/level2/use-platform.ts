'use client';
/** Level 2 — shared client state for the dashboards. */
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
