export type ClassroomExitDecision = {
  readonly kind: 'push';
  readonly href: '/workspace' | '/platform' | '/';
};

interface ClassroomExitContext {
  readonly searchParams: Pick<URLSearchParams, 'get'>;
}

interface ClassroomExitRouter {
  readonly push: (href: string) => void;
}

/**
 * Resolve where a standalone classroom should exit without depending on
 * browser globals, so direct links and SSR callers get the same safe default.
 *
 * A classic classroom always exits to home. The previous history entry is
 * often an entry-time flow (generation-preview) that is not a return target —
 * backing into it shows a dead "no generation in progress" page — so browser
 * history is never used for the classic arrow, which is labeled "back to
 * home" anyway. Only workbench-attached classrooms get a different
 * destination, via their explicit URL contract (`from=workspace` /
 * `returnTo=home`).
 */
export function resolveClassroomExit({
  searchParams,
}: ClassroomExitContext): ClassroomExitDecision {
  // An explicit source wins over history: classroom state changes may push
  // intermediate entries onto the stack, while `from` survives refreshes and
  // does not depend on browser-specific history behaviour.
  if (searchParams.get('from') === 'workspace') {
    return { kind: 'push', href: '/workspace' };
  }
  // Leaving Pro playback opens the ordinary classroom with an explicit home
  // return contract. Browser history still contains the Pro workspace, so
  // without this rule the home arrow would contradict the workspace link.
  if (searchParams.get('returnTo') === 'home') {
    return { kind: 'push', href: '/' };
  }
  // A class opened from the teaching platform belongs to a course, and its
  // reader has a course list to go back to. Without this they landed on the
  // OpenMAIC workspace — "Hi, Learner, tell me anything you want to learn" —
  // which has nothing to do with the class they just left (O5). `/platform`
  // asks the server who they are and forwards to their own dashboard, so one
  // keyword serves all four roles and no path is ever taken from the query
  // string.
  if (searchParams.get('from') === 'platform') {
    return { kind: 'push', href: '/platform' };
  }
  return { kind: 'push', href: '/' };
}

/** Resolve against the current browser, then perform the selected exit. */
export function exitClassroom(
  router: ClassroomExitRouter,
  searchParams: Pick<URLSearchParams, 'get'>,
): void {
  router.push(resolveClassroomExit({ searchParams }).href);
}

export function classroomExitLabelKey(
  searchParams: Pick<URLSearchParams, 'get'>,
): 'workbench.common.backToWorkspace' | 'platform.backToCourses' | 'generation.backToHome' {
  if (searchParams.get('from') === 'workspace') return 'workbench.common.backToWorkspace';
  if (searchParams.get('from') === 'platform') return 'platform.backToCourses';
  return 'generation.backToHome';
}

export function classroomEntryHref(stageId: string, discoverOnly: boolean): string {
  const href = `/classroom/${stageId}`;
  return discoverOnly ? `${href}?from=workspace` : href;
}

/** Opening a course from a platform dashboard, so the exit arrow comes back here. */
export function platformClassroomHref(stageId: string): string {
  return `/classroom/${stageId}?from=platform`;
}
