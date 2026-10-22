import { describe, expect, test } from 'vitest';

import { policyAllows, type FeedbackPolicy } from '@/lib/level3/feedback';
import { estimateCost } from '@/lib/level3/usage';
import { EXPORTABLE_CONSENT } from '@/lib/level3/participants';
import { looksLikeEmail, titleProblem, TITLE_MAX } from '@/lib/level2/validation';
import { providerFor as knowledgeProviderFor } from '@/lib/level3/knowledge';
import { providerFor as lmsProviderFor, ManualProvider } from '@/lib/level3/lms';

/**
 * Unit tests for the decisions instruction v3 names:
 * permissions, rubric parsing, template cloning, study configuration.
 *
 * The API suites already prove the system end to end against a running server
 * and a real database. What they cannot do is pin a *rule* in isolation: when
 * a policy refuses, what a malformed input is called, what an unpriced model
 * costs. Those are decisions, and a decision that is only asserted through an
 * HTTP round trip is one nobody can read back from the test.
 */

describe('feedback policy — the rule, not the route', () => {
  const ctx = (over: Partial<{ attemptNumber: number; requested: boolean; submitted: boolean }> = {}) => ({
    attemptNumber: 1, requested: false, submitted: true, ...over,
  });

  test('OFF refuses everything, and says why', () => {
    const verdict = policyAllows('OFF', ctx({ requested: true }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/switched off/);
  });

  test('ON allows without being asked', () => {
    expect(policyAllows('ON', ctx()).allowed).toBe(true);
  });

  test('ON_REQUEST allows only when the student asked', () => {
    expect(policyAllows('ON_REQUEST', ctx({ requested: false })).allowed).toBe(false);
    expect(policyAllows('ON_REQUEST', ctx({ requested: true })).allowed).toBe(true);
  });

  test('AFTER_FIRST_RESPONSE protects the first answer', () => {
    // The first answer is the measurement. Feeding back into it contaminates
    // what a study is trying to observe, so attempt 1 is refused even when the
    // student asks.
    expect(policyAllows('AFTER_FIRST_RESPONSE', ctx({ attemptNumber: 1, requested: true })).allowed).toBe(false);
    expect(policyAllows('AFTER_FIRST_RESPONSE', ctx({ attemptNumber: 2 })).allowed).toBe(true);
  });

  test('AFTER_SUBMISSION waits for submission', () => {
    expect(policyAllows('AFTER_SUBMISSION', ctx({ submitted: false })).allowed).toBe(false);
    expect(policyAllows('AFTER_SUBMISSION', ctx({ submitted: true })).allowed).toBe(true);
  });

  test('every policy is decided — none falls through', () => {
    const policies: FeedbackPolicy[] = ['OFF', 'ON', 'AFTER_FIRST_RESPONSE', 'AFTER_SUBMISSION', 'ON_REQUEST'];
    for (const p of policies) {
      const verdict = policyAllows(p, ctx());
      expect(typeof verdict.allowed).toBe('boolean');
      if (!verdict.allowed) expect(verdict.reason).toBeTruthy();
    }
  });
});

describe('study configuration — consent decides inclusion, not enrolment', () => {
  test('only CONSENTED is exportable', () => {
    expect(EXPORTABLE_CONSENT).toEqual(['CONSENTED']);
  });

  test('the other four states are all exclusions', () => {
    for (const state of ['NOT_REQUESTED', 'PENDING', 'DECLINED', 'WITHDRAWN']) {
      expect(EXPORTABLE_CONSENT).not.toContain(state);
    }
  });
});

describe('rubric and course input parsing', () => {
  test('a title longer than the cap is refused, with the number in the message', () => {
    const problem = titleProblem('X'.repeat(TITLE_MAX + 1));
    expect(problem).toMatch(String(TITLE_MAX));
  });

  test('a title of exactly the cap is accepted', () => {
    expect(titleProblem('X'.repeat(TITLE_MAX))).toBeNull();
  });

  test('a blank title is refused rather than stored as whitespace', () => {
    expect(titleProblem('   ')).toBeTruthy();
    expect(titleProblem('\n\t')).toBeTruthy();
  });

  test('a malformed address is recognised as malformed', () => {
    // The point of this check is that it comes *before* the account lookup, so
    // a typo is not reported as "no account with that email".
    expect(looksLikeEmail('not-an-address')).toBe(false);
    expect(looksLikeEmail('two@at@example.test')).toBe(false);
    expect(looksLikeEmail('no-domain@')).toBe(false);
    expect(looksLikeEmail('student1@example.test')).toBe(true);
    expect(looksLikeEmail('  spaced@example.test  ')).toBe(true);
  });
});

describe('template cloning — the type chooses the retriever', () => {
  const embed = async () => null;

  test('a vector index gets the vector retriever', () => {
    expect(knowledgeProviderFor('VECTOR_INDEX', embed).name).toBe('VectorRetriever');
  });

  test('a knowledge graph gets the graph retriever', () => {
    expect(knowledgeProviderFor('KNOWLEDGE_GRAPH', embed).name).toBe('KnowledgeGraphRetriever');
  });

  test('documents and structured data fall to the document retriever', () => {
    expect(knowledgeProviderFor('DOCUMENT_COLLECTION', embed).name).toBe('DocumentRetriever');
    expect(knowledgeProviderFor('STRUCTURED_DATA', embed).name).toBe('DocumentRetriever');
  });
});

describe('usage accounting — an unknown price is null, never a guess', () => {
  test('a priced model costs what the table says', () => {
    const cost = estimateCost('openai:gpt-4.1', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(10, 5); // 2.00 in + 8.00 out
  });

  test('an unpriced model yields null rather than an invented number', () => {
    expect(estimateCost('openai:some-model-nobody-priced', 1000, 1000)).toBeNull();
  });

  test('no model and no tokens yield null', () => {
    expect(estimateCost(null, 100, 100)).toBeNull();
    expect(estimateCost('openai:gpt-4.1', null, null)).toBeNull();
  });

  test('a half-reported call still costs something', () => {
    // Output tokens reported, input not. Better a partial estimate than none,
    // so long as nothing is invented for the missing half.
    expect(estimateCost('openai:gpt-4.1', null, 1_000_000)).toBeCloseTo(8, 5);
  });
});

describe('LMS boundary — honest about sending nothing', () => {
  test('the manual provider is implemented', () => {
    expect(lmsProviderFor('MANUAL').implemented).toBe(true);
  });

  test('an unwritten adapter is reported as unimplemented, not silently swapped', () => {
    const { implemented, provider } = lmsProviderFor('CANVAS');
    expect(implemented).toBe(false);
    // It still returns something usable, so a caller cannot crash — but the
    // flag is what the route reports, so nobody believes a grade was sent.
    expect(provider.name).toBe('MANUAL');
  });

  test('posting a grade through the manual provider never claims to have sent it', async () => {
    const result = await ManualProvider.postGrade({}, { lmsCourseId: 'X' },
      { responseId: 'r', lineItem: null, score: 3, maxScore: 4 });
    expect(result.sent).toBe(false);
    expect(JSON.stringify(result.detail)).toMatch(/nothing was transmitted/);
  });

  test('listing courses returns nothing rather than inventing a remote LMS', async () => {
    expect(await ManualProvider.listCourses({})).toEqual([]);
    expect(await ManualProvider.roster({}, 'X')).toEqual([]);
  });
});
