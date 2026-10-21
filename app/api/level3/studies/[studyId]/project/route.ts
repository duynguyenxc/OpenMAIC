/**
 * Level 3A — rebuild the research events for a study from OpenMAIC's records.
 *
 * Separate from the classroom on purpose. *"Do not block interactive student
 * classroom operation with long-running research jobs"*, and *"The student
 * classroom must continue functioning even if the analytics service fails."*
 * Nothing in the teaching path calls this; it reads records that already
 * exist, and it is safe to run again at any time because the projection is
 * idempotent.
 */
import { requireStudyAccess } from '@/lib/level3/authorization';
import { projectStudyEvents } from '@/lib/level3/events';
import { json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ studyId: string }> };

export function POST(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { studyId } = await params;
    await requireStudyAccess(ownerId, studyId, ['RESEARCHER', 'DATA_MANAGER']);
    const results = await projectStudyEvents(studyId);
    const total = results.reduce(
      (acc, r) => ({
        examined: acc.examined + r.result.examined,
        written: acc.written + r.result.written,
        skippedUnmapped: acc.skippedUnmapped + r.result.skippedUnmapped,
      }),
      { examined: 0, written: 0, skippedUnmapped: 0 },
    );
    return json({ courses: results, total }, 200, headers);
  });
}
