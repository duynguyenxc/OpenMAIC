/**
 * Level 2 — reading the Supabase session on the server.
 *
 * This project's Supabase instance signs access tokens with ES256 and
 * publishes the public key at `/auth/v1/.well-known/jwks.json`, so the legacy
 * `SUPABASE_JWT_SECRET` (HS256) cannot verify them. `auth.getClaims()` does
 * the right thing: it fetches and caches the JWKS and verifies locally, so a
 * request costs no round trip to the Auth server once the key set is held.
 *
 * Cookies are read only. The browser's Supabase client owns the session and
 * refreshes it; an expired token here is reported as invalid and the client
 * renews it, which keeps this module free of cookie-minting responsibilities.
 */
import { createServerClient } from '@supabase/ssr';

export interface SessionClaims {
  /** Supabase `auth.users.id`. */
  readonly userId: string;
  readonly email: string;
}

export type SessionOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'session'; readonly claims: SessionClaims };

function parseCookies(header: string | null): { name: string; value: string }[] {
  if (!header) return [];
  const out: { name: string; value: string }[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    out.push({ name, value: decodeURIComponent(part.slice(eq + 1).trim()) });
  }
  return out;
}

function configuration(): { url: string; key: string } | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY;
  return url && key ? { url, key } : undefined;
}

/** Whether Supabase authentication is configured at all. */
export function supabaseAuthConfigured(): boolean {
  return configuration() !== undefined;
}

export async function readSession(headers: Headers): Promise<SessionOutcome> {
  const config = configuration();
  if (!config) return { kind: 'none' };

  const cookies = parseCookies(headers.get('cookie'));
  // No Supabase cookie at all: this request carries no credential of our kind,
  // which the identity contract distinguishes sharply from a broken one.
  if (!cookies.some((cookie) => cookie.name.startsWith('sb-'))) return { kind: 'none' };

  const client = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookies,
      // Read-only: the browser client owns refresh. Supplying a no-op keeps
      // @supabase/ssr from warning about a missing setter.
      setAll: () => undefined,
    },
  });

  try {
    const { data, error } = await client.auth.getClaims();
    if (error) return { kind: 'invalid', reason: error.message };
    const claims = data?.claims;
    const userId = typeof claims?.sub === 'string' ? claims.sub : undefined;
    if (!userId) return { kind: 'invalid', reason: 'token carries no subject' };
    const email = typeof claims?.email === 'string' ? claims.email : '';
    return { kind: 'session', claims: { userId, email } };
  } catch (cause) {
    return {
      kind: 'invalid',
      reason: cause instanceof Error ? cause.message : 'session could not be verified',
    };
  }
}
