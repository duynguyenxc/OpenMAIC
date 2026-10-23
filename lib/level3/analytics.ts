/**
 * Level 3D — research analytics.
 *
 * Not a dashboard of pretty numbers. Four questions a researcher on this
 * platform would actually ask, each answerable because of a decision made
 * earlier:
 *
 * 1. **Do the conditions differ?** — possible because every section carries a
 *    condition label and a configuration snapshot.
 * 2. **How often did the AI and the human agree?** — possible only because
 *    neither score ever overwrote the other.
 * 3. **Did revision improve anything?** — possible because every attempt was
 *    kept rather than updated.
 * 4. **What did it cost, and where?** — see `usage.ts`.
 *
 * Every figure here says how much data it rests on. A mean of two is reported
 * as a mean of two, because a number without its n invites a conclusion it
 * cannot carry.
 */
import { level2Pool } from '@/lib/level2/db';

/** One row of the condition breakdown; see the note in events.ts on why these
 *  are named rather than left as `Record<string, any>`. */
interface ConditionRow {
  condition: string | null;
  sections: number;
  participants: number;
  responses: number;
  revisions: number;
  feedbackShown: number;
}

/** The single row the revision comparison returns. */
interface RevisionRow {
  learners: number;
  pairs: number;
  improved: number;
  unchanged: number;
  worsened: number;
  mean: number | null;
}

export interface ConditionSummary {
  condition: string | null;
  sections: number;
  participants: number;
  responses: number;
  revisions: number;
  feedbackShown: number;
  meanFinalScore: number | null;
  scoredResponses: number;
}

export interface AgreementSummary {
  comparable: number;
  exactAgreements: number;
  humanHigher: number;
  humanLower: number;
  meanAbsoluteDifference: number | null;
  decisions: Record<string, number>;
}

export interface RevisionSummary {
  learnersWhoRevised: number;
  pairsCompared: number;
  improved: number;
  unchanged: number;
  worsened: number;
  meanChange: number | null;
}

export async function conditionBreakdown(studyId: string): Promise<ConditionSummary[]> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `SELECT sc.experimental_condition AS condition,
            count(DISTINCT c.id)::int                                   AS sections,
            count(DISTINCT rp.id)::int                                  AS participants,
            count(DISTINCT lr.id)::int                                  AS responses,
            count(DISTINCT lr.id) FILTER (WHERE lr.attempt_number > 1)::int AS revisions,
            count(DISTINCT fe.id) FILTER (WHERE fe.shown_at IS NOT NULL)::int AS "feedbackShown"
       FROM study_courses sc
       JOIN courses c ON c.id = sc.course_id
       LEFT JOIN learner_responses lr ON lr.course_id = c.id
       LEFT JOIN feedback_events fe ON fe.response_id = lr.id
       LEFT JOIN research_participants rp
              ON rp.study_id = sc.study_id AND rp.user_id = lr.learner_id
      WHERE sc.study_id = $1
      GROUP BY sc.experimental_condition
      ORDER BY sc.experimental_condition NULLS LAST`,
    [studyId],
  );

  // The mean is computed over *final* scores only — a human's, or an AI score
  // a human accepted. An unreviewed AI score is not a result.
  const out: ConditionSummary[] = [];
  for (const row of rows as ConditionRow[]) {
    const { rows: scored } = await pool.query(
      `WITH final AS (
         SELECT lr.id AS response_id,
                COALESCE(
                  (SELECT avg(s.score) FROM assessment_scores s
                     JOIN assessments a ON a.id = s.assessment_id
                    WHERE a.response_id = lr.id AND a.assessor_kind = 'HUMAN'),
                  CASE WHEN EXISTS (SELECT 1 FROM assessment_reviews ar
                                     WHERE ar.response_id = lr.id AND ar.decision = 'ACCEPTED')
                       THEN (SELECT avg(s.score) FROM assessment_scores s
                               JOIN assessments a ON a.id = s.assessment_id
                              WHERE a.response_id = lr.id AND a.assessor_kind = 'AI')
                  END) AS score
           FROM study_courses sc
           JOIN courses c ON c.id = sc.course_id
           JOIN learner_responses lr ON lr.course_id = c.id
          WHERE sc.study_id = $1
            AND sc.experimental_condition IS NOT DISTINCT FROM $2)
       SELECT avg(score)::float AS mean, count(score)::int AS n FROM final`,
      [studyId, row.condition],
    );
    const s = scored[0] as { mean: number | null; n: number };
    out.push({
      ...(row as object),
      meanFinalScore: s.mean,
      scoredResponses: s.n,
    } as ConditionSummary);
  }
  return out;
}

/**
 * AI against human, per rubric dimension.
 *
 * Only responses where **both** exist are comparable, and that count is
 * reported first, because an agreement rate over three responses means
 * nothing and should look like it means nothing.
 */
export async function aiHumanAgreement(studyId: string): Promise<AgreementSummary> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `WITH pairs AS (
       SELECT ai.dimension_id, ai.score AS ai_score, hu.score AS human_score
         FROM study_courses sc
         JOIN courses c ON c.id = sc.course_id
         JOIN learner_responses lr ON lr.course_id = c.id
         JOIN assessments aa ON aa.response_id = lr.id AND aa.assessor_kind = 'AI'
         JOIN assessment_scores ai ON ai.assessment_id = aa.id
         JOIN assessments ah ON ah.response_id = lr.id AND ah.assessor_kind = 'HUMAN'
         JOIN assessment_scores hu ON hu.assessment_id = ah.id
                                  AND hu.dimension_id = ai.dimension_id
        WHERE sc.study_id = $1)
     SELECT count(*)::int                                            AS comparable,
            count(*) FILTER (WHERE ai_score = human_score)::int      AS exact,
            count(*) FILTER (WHERE human_score > ai_score)::int      AS higher,
            count(*) FILTER (WHERE human_score < ai_score)::int      AS lower,
            avg(abs(human_score - ai_score))::float                  AS mad
       FROM pairs`,
    [studyId],
  );
  const r = rows[0] as {
    comparable: number;
    exact: number;
    higher: number;
    lower: number;
    mad: number | null;
  };

  const { rows: decisions } = await pool.query(
    `SELECT ar.decision, count(*)::int n
       FROM study_courses sc
       JOIN courses c ON c.id = sc.course_id
       JOIN learner_responses lr ON lr.course_id = c.id
       JOIN assessment_reviews ar ON ar.response_id = lr.id
      WHERE sc.study_id = $1
      GROUP BY ar.decision`,
    [studyId],
  );

  return {
    comparable: r.comparable,
    exactAgreements: r.exact,
    humanHigher: r.higher,
    humanLower: r.lower,
    meanAbsoluteDifference: r.mad,
    decisions: Object.fromEntries(
      (decisions as Array<{ decision: string; n: number }>).map((d) => [d.decision, d.n]),
    ),
  };
}

/**
 * Did the second attempt score better than the first?
 *
 * Only pairs where both attempts carry a score are compared, and the count of
 * pairs is reported, for the same reason as above. This is the measurement
 * that *"Store each version independently"* was for.
 */
export async function revisionEffect(studyId: string): Promise<RevisionSummary> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `WITH scored AS (
       SELECT lr.id, lr.learner_id, lr.course_id, lr.activity_id, lr.attempt_number,
              (SELECT avg(s.score) FROM assessment_scores s
                 JOIN assessments a ON a.id = s.assessment_id
                WHERE a.response_id = lr.id) AS score
         FROM study_courses sc
         JOIN courses c ON c.id = sc.course_id
         JOIN learner_responses lr ON lr.course_id = c.id
        WHERE sc.study_id = $1),
     pairs AS (
       SELECT a.learner_id, b.score - a.score AS delta
         FROM scored a JOIN scored b
           ON b.learner_id = a.learner_id AND b.course_id = a.course_id
          AND b.activity_id = a.activity_id AND b.attempt_number = a.attempt_number + 1
        WHERE a.score IS NOT NULL AND b.score IS NOT NULL)
     SELECT count(DISTINCT learner_id)::int        AS learners,
            count(*)::int                          AS pairs,
            count(*) FILTER (WHERE delta > 0)::int AS improved,
            count(*) FILTER (WHERE delta = 0)::int AS unchanged,
            count(*) FILTER (WHERE delta < 0)::int AS worsened,
            avg(delta)::float                      AS mean
       FROM pairs`,
    [studyId],
  );
  const r = rows[0] as RevisionRow;
  return {
    learnersWhoRevised: r.learners,
    pairsCompared: r.pairs,
    improved: r.improved,
    unchanged: r.unchanged,
    worsened: r.worsened,
    meanChange: r.mean,
  };
}
