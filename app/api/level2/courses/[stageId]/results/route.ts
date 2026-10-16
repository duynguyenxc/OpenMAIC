/** Level 2 — course results, and one student's trajectory with ?email=. */
import { requireCourseInstructor } from '@/lib/level2/authorization';
import { courseResults, courseTrajectory } from '@/lib/level2/course-results';
import { json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { stageId } = await params;
    // Any instructor on the course may inspect its students; an instructor of
    // another course gets 403 from here, never a filtered empty list.
    await requireCourseInstructor(ownerId, stageId);
    const email = new URL(req.url).searchParams.get('email');
    if (email) {
      return json({ email, events: await courseTrajectory(stageId, email) }, 200, headers);
    }
    return json({ students: await courseResults(stageId) }, 200, headers);
  });
}
