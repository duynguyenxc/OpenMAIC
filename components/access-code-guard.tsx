'use client';

import { useEffect, useState, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AccessCodeModal } from '@/components/access-code-modal';
import { useSettingsStore } from '@/lib/store/settings';

/** Pages a visitor may reach without an account. */
const PUBLIC_PATHS = ['/platform/login'];

/** Whether this deployment authorizes by account (Level 2) rather than by a shared code. */
const ACCOUNTS_ENABLED = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

export function AccessCodeGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // undefined while unknown, so nothing renders on a guess.
  const [signedIn, setSignedIn] = useState<boolean | undefined>(
    ACCOUNTS_ENABLED ? undefined : true,
  );
  const [status, setStatus] = useState<{
    enabled: boolean;
    authenticated: boolean;
    loading: boolean;
  }>({ enabled: false, authenticated: false, loading: true });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/access-code/status')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setStatus({
            enabled: data.enabled,
            authenticated: data.authenticated,
            loading: false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Default to requiring auth on error — safer than silently disabling
          setStatus({ enabled: true, authenticated: false, loading: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Where accounts authorize, a visitor with no session must be sent to sign
  // in rather than left on a page that will answer 401 to everything it asks
  // for. Without this, opening the site unauthenticated showed OpenMAIC's
  // workspace and then "Persistence is unavailable", which looks like a broken
  // deployment rather than a sign-in prompt.
  // Which path the answer in `signedIn` was obtained for. A "signed out"
  // answer from the previous page must not be acted on here: signing in
  // navigates away from /platform/login, and bouncing on that stale answer
  // sent the visitor straight back to a blank sign-in form, so the first
  // attempt always appeared to do nothing.
  const [verifiedPath, setVerifiedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!ACCOUNTS_ENABLED) return;
    let cancelled = false;
    fetch('/api/level2/me', { credentials: 'same-origin' })
      .then((res) => {
        if (cancelled) return;
        setSignedIn(res.ok);
        setVerifiedPath(pathname ?? null);
      })
      .catch(() => {
        // A network failure is not proof of being signed out; render rather
        // than bounce someone to sign-in over a dropped request.
        if (cancelled) return;
        setSignedIn(true);
        setVerifiedPath(pathname ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname?.startsWith(path));
  const verifiedHere = verifiedPath === (pathname ?? null);

  useEffect(() => {
    if (ACCOUNTS_ENABLED && signedIn === false && verifiedHere && !isPublicPath) {
      router.replace('/platform/login');
    }
  }, [signedIn, verifiedHere, isPublicPath, router]);

  const needsAuth = !status.loading && status.enabled && !status.authenticated;

  // Children must not mount until the gate is resolved. They used to render
  // alongside the modal, so a page opened directly by URL (e.g.
  // /classroom/<id>) issued its data requests before any access cookie
  // existed: the middleware answered 401 and the page showed a storage error
  // that only a manual Retry cleared. Holding children back until the visitor
  // is authenticated removes that race for every gated page, rather than
  // patching one symptom at a time.
  if (status.loading) return null;
  // Hold the page while the session is unknown, and while a redirect to
  // sign-in is on its way, so no child issues a request that must 401.
  if (ACCOUNTS_ENABLED && !isPublicPath && signedIn !== true) return null;

  if (needsAuth) {
    return (
      <AccessCodeModal
        open={true}
        onSuccess={() => {
          setStatus((s) => ({ ...s, authenticated: true }));
          // ServerProvidersInit ran on mount before any access cookie existed,
          // so the store kept its blank defaults. Re-fetch now that the
          // request will be authorized.
          void useSettingsStore.getState().fetchServerProviders();
        }}
      />
    );
  }

  return <>{children}</>;
}
