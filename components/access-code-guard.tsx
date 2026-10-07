'use client';

import { useEffect, useState, ReactNode } from 'react';
import { AccessCodeModal } from '@/components/access-code-modal';
import { useSettingsStore } from '@/lib/store/settings';

export function AccessCodeGuard({ children }: { children: ReactNode }) {
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

  const needsAuth = !status.loading && status.enabled && !status.authenticated;

  // Children must not mount until the gate is resolved. They used to render
  // alongside the modal, so a page opened directly by URL (e.g.
  // /classroom/<id>) issued its data requests before any access cookie
  // existed: the middleware answered 401 and the page showed a storage error
  // that only a manual Retry cleared. Holding children back until the visitor
  // is authenticated removes that race for every gated page, rather than
  // patching one symptom at a time.
  if (status.loading) return null;

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
