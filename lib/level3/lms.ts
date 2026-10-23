/**
 * Level 3D — the LMS boundary.
 *
 * *"Do NOT make Canvas integration mandatory for Level 3. Create an
 * integration boundary for future LMS support. ... Keep the core platform
 * independently usable without Canvas."*
 *
 * So this file is the **boundary**, not Canvas. What exists is an interface
 * shaped by what LTI 1.3 actually needs — a launch that maps a context to a
 * course, a roster, and a grade going back — and one implementation that does
 * none of those over a network.
 *
 * That implementation, `ManualProvider`, is not a stub pretending to be an
 * integration. It is how most pilots genuinely work: an instructor exports
 * grades and carries them into the LMS by hand. It returns real data from this
 * platform and is honest that nothing was sent anywhere, which is worth more
 * than a Canvas adapter nobody has credentials to test.
 *
 * Writing a Canvas adapter means implementing `LmsProvider` and registering
 * it. Nothing above this file would change, and nothing above it imports
 * Canvas, LTI, or any vendor name.
 */
import { level2Pool } from '@/lib/level2/db';

export interface LmsCourseRef {
  lmsCourseId: string;
  label: string | null;
}

export interface LmsRosterEntry {
  lmsUserId: string;
  email: string | null;
  name: string | null;
  role: 'INSTRUCTOR' | 'STUDENT' | 'OTHER';
}

export interface GradePosting {
  responseId: string;
  lineItem: string | null;
  score: number | null;
  maxScore: number | null;
}

export interface GradeResult {
  sent: boolean;
  detail: Record<string, unknown>;
}

/**
 * What any LMS adapter must provide. Four capabilities, because those are the
 * four the instruction names: launch and course mapping, roster, grade return.
 */
export interface LmsProvider {
  readonly name: string;
  /** Whether a launch/credential set is usable. Never throws. */
  verify(integration: Record<string, unknown>): Promise<{ ok: boolean; detail: string }>;
  /** Courses this integration can see, for mapping to ours. */
  listCourses(integration: Record<string, unknown>): Promise<LmsCourseRef[]>;
  /** Who is in an LMS course, for roster synchronisation. */
  roster(integration: Record<string, unknown>, lmsCourseId: string): Promise<LmsRosterEntry[]>;
  /** Send one grade back. */
  postGrade(
    integration: Record<string, unknown>,
    link: { lmsCourseId: string },
    posting: GradePosting,
  ): Promise<GradeResult>;
}

/**
 * The provider that sends nothing.
 *
 * Everything it returns is true about *this* platform; what it does not do is
 * contact an LMS, and it says so in every `detail`. A grade "posted" through
 * it is recorded as `PREPARED`, never `SENT`.
 */
export const ManualProvider: LmsProvider = {
  name: 'MANUAL',

  async verify() {
    return {
      ok: true,
      detail:
        'Manual integration: grades and rosters are exported and carried into the LMS by a ' +
        'person. Nothing is sent over a network.',
    };
  },

  async listCourses() {
    // There is no remote LMS to list. Returning our own courses here would be
    // a lie dressed as a feature.
    return [];
  },

  async roster() {
    return [];
  },

  async postGrade(_integration, _link, posting) {
    return {
      sent: false,
      detail: {
        reason: 'manual integration — nothing was transmitted',
        prepared: posting,
        nextStep: 'export the grades and enter them in the LMS',
      },
    };
  },
};

/**
 * Where a real adapter plugs in.
 *
 * A Canvas implementation is `LmsProvider` with LTI 1.3 behind it, registered
 * here under `'CANVAS'`. Until one exists, asking for it returns the manual
 * provider **and the request is answered honestly** by the route, rather than
 * silently falling back and leaving someone to believe a grade was sent.
 */
const PROVIDERS: Record<string, LmsProvider> = {
  MANUAL: ManualProvider,
};

export function providerFor(name: string): { provider: LmsProvider; implemented: boolean } {
  const provider = PROVIDERS[name];
  return provider
    ? { provider, implemented: true }
    : { provider: ManualProvider, implemented: false };
}

export function availableProviders(): string[] {
  return Object.keys(PROVIDERS);
}

/**
 * Prepare the grade for one response.
 *
 * The score is the **final** one — a human's if there is one, an accepted AI
 * score otherwise. An unreviewed AI score is never sent anywhere, which is the
 * same rule the rest of the platform follows and matters most at the moment a
 * number leaves for somebody's grade book.
 */
export async function prepareGrade(responseId: string): Promise<GradePosting | null> {
  const { scoresFor } = await import('./assessment');
  const scores = await scoresFor(responseId);
  if (scores.final.source === 'NONE' || scores.final.scores.length === 0) return null;

  const pool = await level2Pool();
  const { rows } = await pool.query(
    `SELECT a.rubric_id AS "rubricId" FROM assessments a
      WHERE a.response_id = $1 ORDER BY a.created_at DESC LIMIT 1`,
    [responseId],
  );
  const rubricId = (rows[0] as { rubricId?: string } | undefined)?.rubricId;

  let maxScore: number | null = null;
  if (rubricId) {
    const { rows: dims } = await pool.query(
      `SELECT sum(max_score)::float AS total FROM rubric_dimensions WHERE rubric_id = $1`,
      [rubricId],
    );
    maxScore = (dims[0] as { total: number | null }).total;
  }

  const score = scores.final.scores.reduce((sum, s) => sum + Number(s.score), 0);
  return { responseId, lineItem: null, score, maxScore };
}
