/**
 * Level 3D — what the models cost, and where.
 *
 * Aggregated by the four dimensions the instruction names, plus by model.
 * `knownTokens` says how many of the requests actually reported usage, because
 * a small cost can mean cheap models or a provider that reports nothing, and
 * those are different facts.
 */
import { requirePlatformAdmin } from '@/lib/level3/authorization';
import { usageBy, type UsageDimension } from '@/lib/level3/usage';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DIMENSIONS = new Set(['course', 'instructor', 'study', 'institution', 'model']);

export function GET(req: Request): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    // Spending is platform administration. An instructor seeing their own
    // course's usage is a reasonable later addition; guessing at it now would
    // be inventing a permission nobody asked for.
    await requirePlatformAdmin(ownerId);
    const by = new URL(req.url).searchParams.get('by') ?? 'model';
    if (!DIMENSIONS.has(by)) {
      return apiError(400, 'INVALID_DIMENSION',
        'by must be course, instructor, study, institution or model', headers);
    }
    return json({ by, rows: await usageBy(by as UsageDimension) }, 200, headers);
  });
}
