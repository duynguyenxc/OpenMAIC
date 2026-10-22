'use client';
/**
 * Level 2 — the entry point.
 *
 * The server decides which dashboard an account belongs to: the client asks
 * /api/level2/me and follows the role it is told. It never infers a role from
 * anything it holds locally, so a tampered client reaches a dashboard it is
 * not entitled to only to find every API call behind it refused.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useMe } from '@/lib/level2/use-platform';

export default function PlatformEntry() {
  const router = useRouter();
  const me = useMe();

  useEffect(() => {
    if (me === undefined) return;
    if (me === null) {
      router.replace('/platform/login');
      return;
    }
    router.replace(homeFor(me.role));
  }, [me, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground text-sm">Loading…</p>
    </main>
  );
}
