/**
 * Level 2 — shared input checks.
 *
 * Adversarial testing on 2026-10-21 found two messages that blamed the wrong
 * thing: a malformed address came back as "no account with that email", which
 * sends the reader looking for an account that was never the problem, and a
 * 5,000-character title was stored without complaint. Both are here so every
 * route answers the same way.
 */

/** Deliberately permissive: this rejects what is obviously not an address, and
 *  leaves deciding whether an account exists to the lookup that follows. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}

/** Long enough for a real course name, short enough not to wreck a table row
 *  or an export column. */
export const TITLE_MAX = 200;

export function titleProblem(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return 'a course title cannot be empty';
  if (trimmed.length > TITLE_MAX)
    return `a course title cannot be longer than ${TITLE_MAX} characters`;
  return null;
}
