'use client';
/**
 * Level 2 — the browser's Supabase client.
 *
 * `createBrowserClient` stores the session in cookies rather than
 * localStorage, which is what makes it readable by the server: the owner auth
 * method reads the same cookie on every request. A client that kept the
 * session in localStorage would sign the user in visually and leave every API
 * call unauthenticated.
 */
import { createBrowserClient } from '@supabase/ssr';

let client: ReturnType<typeof createBrowserClient> | undefined;

export function supabaseBrowser() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Supabase is not configured for the browser');
    client = createBrowserClient(url, key);
  }
  return client;
}
