import { describe, expect, it, vi } from 'vitest';
import {
  classroomEntryHref,
  classroomExitLabelKey,
  exitClassroom,
  platformClassroomHref,
  resolveClassroomExit,
} from '@/lib/workbench/classroom-exit';

const params = (query = '') => new URLSearchParams(query);

describe('resolveClassroomExit', () => {
  it('returns to the workspace for an explicit workspace source', () => {
    expect(resolveClassroomExit({ searchParams: params('from=workspace') })).toEqual({
      kind: 'push',
      href: '/workspace',
    });
  });

  it('goes home for a classic classroom even when browser history exists', () => {
    // The previous history entry is often an entry-time flow (generation-preview)
    // that must never be a return target, so the classic arrow always pushes home.
    expect(resolveClassroomExit({ searchParams: params() })).toEqual({ kind: 'push', href: '/' });
  });

  it('falls back to home for a direct link such as /shared/<token>', () => {
    expect(resolveClassroomExit({ searchParams: params() })).toEqual({ kind: 'push', href: '/' });
  });

  it('prioritizes an explicit workspace source over everything else', () => {
    expect(resolveClassroomExit({ searchParams: params('from=workspace') })).toEqual({
      kind: 'push',
      href: '/workspace',
    });
  });

  it('returns to home explicitly instead of reopening Pro through browser history', () => {
    expect(resolveClassroomExit({ searchParams: params('returnTo=home') })).toEqual({
      kind: 'push',
      href: '/',
    });
  });

  it('returns a platform learner to their own dashboard, not the workspace', () => {
    // A student leaving a course used to land on "Hi, Learner — tell me
    // anything you want to learn", which is not where they came from.
    // `/platform` asks the server who they are and forwards from there, so one
    // keyword covers all four roles and no path comes from the query string.
    expect(resolveClassroomExit({ searchParams: params('from=platform') })).toEqual({
      kind: 'push',
      href: '/platform',
    });
  });

  it('still prefers an explicit workspace source over a platform one', () => {
    expect(resolveClassroomExit({ searchParams: params('from=workspace&returnTo=home') })).toEqual({
      kind: 'push',
      href: '/workspace',
    });
  });
});

describe('exitClassroom', () => {
  it('pushes the resolved destination and never uses browser history', () => {
    const router = { push: vi.fn() };

    exitClassroom(router, params());

    expect(router.push).toHaveBeenCalledWith('/');
  });

  it('returns to the workspace for a workspace-attached classroom', () => {
    const router = { push: vi.fn() };

    exitClassroom(router, params('from=workspace'));

    expect(router.push).toHaveBeenCalledWith('/workspace');
  });
});

describe('classroom navigation metadata', () => {
  it('marks workspace entries and leaves classic entries unchanged', () => {
    expect(classroomEntryHref('course-1', true)).toBe('/classroom/course-1?from=workspace');
    expect(classroomEntryHref('course-1', false)).toBe('/classroom/course-1');
  });

  it('uses workspace copy instead of home copy for workspace exits', () => {
    expect(classroomExitLabelKey(params('from=workspace'))).toBe(
      'workbench.common.backToWorkspace',
    );
    expect(classroomExitLabelKey(params())).toBe('generation.backToHome');
  });

  it('marks a platform entry and labels its exit as a return to courses', () => {
    expect(platformClassroomHref('course-1')).toBe('/classroom/course-1?from=platform');
    expect(classroomExitLabelKey(params('from=platform'))).toBe('platform.backToCourses');
  });

  it('has that label in every locale, so the arrow never shows a raw key', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = 'lib/i18n/locales';
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const messages = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
      expect(messages.platform?.backToCourses, file).toBeTruthy();
    }
  });
});
