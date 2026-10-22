/** Level 3D — research analytics for one study. Study access required. */
import { requireStudyAccess } from '@/lib/level3/authorization';
import { aiHumanAgreement, conditionBreakdown, revisionEffect } from '@/lib/level3/analytics';
import { json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ studyId: string }> };

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { studyId } = await params;
    await requireStudyAccess(ownerId, studyId);
    const [conditions, agreement, revisions] = await Promise.all([
      conditionBreakdown(studyId),
      aiHumanAgreement(studyId),
      revisionEffect(studyId),
    ]);
    return json(
      {
        studyId, conditions, agreement, revisions,
        // Said with the numbers rather than in a footnote nobody reads.
        caveats: [
          'Means are over final scores only: a human score, or an AI score a human accepted.',
          'Agreement is computed only where both an AI and a human assessment exist; `comparable` is that count.',
          'Revision effect compares consecutive attempts that both carry a score.',
          'Small counts mean small conclusions. Every figure reports its n.',
        ],
      },
      200,
      headers,
    );
  });
}
