/**
 * Level 3A — the research export.
 *
 * De-identified by default and by construction: the query behind it selects no
 * email and no name. *"Do not expose unrestricted research-export APIs"* —
 * this one requires authorization on the specific study, and an OBSERVER on a
 * study can read it on screen but cannot export it.
 *
 * Every export writes an audit row, and every export carries its data-quality
 * report, so nobody analyses a hole without being told it is there.
 */
import { requireExportPermission } from '@/lib/level3/authorization';
import { exportStudy, toCsv } from '@/lib/level3/export';
import { audit } from '@/lib/level3/audit';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ studyId: string }> };

export function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { studyId } = await params;
    const actor = await requireExportPermission(ownerId, studyId);

    const url = new URL(req.url);
    const format = url.searchParams.get('format') ?? 'json';
    if (!['csv', 'json'].includes(format)) {
      return apiError(400, 'INVALID_FORMAT', 'format must be csv or json', headers);
    }
    // Including non-consenting participants is possible, requires saying so
    // explicitly, and is recorded in the audit log as having happened.
    const includeAll = url.searchParams.get('includeAllConsentStates') === 'true';

    const { rows, quality } = await exportStudy(studyId, { includeAllConsentStates: includeAll });

    await audit({ profileId: actor.profileId }, 'DATA_EXPORTED',
      { type: 'study', id: studyId },
      { format, rows: rows.length, participants: quality.participants, includeAllConsentStates: includeAll });

    if (format === 'csv') {
      return new Response(toCsv(rows), {
        status: 200,
        headers: {
          ...Object.fromEntries(new Headers(headers).entries()),
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="study-${studyId}.csv"`,
        },
      });
    }
    return json({ studyId, quality, rows }, 200, headers);
  });
}
