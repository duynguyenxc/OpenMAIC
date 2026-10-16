/**
 * Level 2 — the shape every platform route shares.
 *
 * `withRequestOwner` resolves the authenticated owner and carries the headers
 * every response must have; this adds the two things our routes also need:
 * a single translation of AuthorizationError into a status, so no route
 * invents its own, and JSON bodies in one shape.
 */
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { AuthorizationError } from './authorization';

export function json(data: unknown, status = 200, headers?: Headers): Response {
  const merged = new Headers(headers);
  merged.set('content-type', 'application/json');
  return new Response(JSON.stringify(data), { status, headers: merged });
}

export function apiError(status: number, code: string, message: string, headers?: Headers): Response {
  return json({ error: { code, message } }, status, headers);
}

/**
 * Run a handler with the authenticated owner id.
 *
 * An unauthenticated request never reaches the handler: identity resolution
 * answers 401 first. An AuthorizationError raised inside becomes its own
 * status, and anything else becomes a 500 without leaking the reason.
 */
export function withOwner(
  req: Request,
  handler: (ownerId: string, headers: Headers) => Promise<Response>,
): Promise<Response> {
  return withRequestOwner(req, async ({ ownerId }, responseHeaders) => {
    try {
      return await handler(ownerId, responseHeaders);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return apiError(error.status, error.code, error.message, responseHeaders);
      }
      console.error('[level2] route failed', error);
      return apiError(500, 'INTERNAL', 'request failed', responseHeaders);
    }
  });
}

/** CSV with the quoting rules a spreadsheet expects. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(','), ...rows.map((row) => columns.map((c) => escape(row[c])).join(','))]
    .join('\n');
}
