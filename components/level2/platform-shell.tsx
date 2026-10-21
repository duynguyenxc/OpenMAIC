'use client';
/**
 * Level 2 — the frame every dashboard shares.
 *
 * It had no navigation at all: `header a, nav a` returned zero elements, so
 * the only control was Sign out and there was no way from the platform back to
 * the OpenMAIC workspace, or between the places a role can go (S3-3). On a
 * phone the account name wrapped across the role chip (S3-9).
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabaseBrowser } from '@/lib/level2/supabase-browser';
import type { Me } from '@/lib/level2/use-platform';

/** Where each role may go. The server refuses anything else regardless. */
function linksFor(role: Me['role']): { href: string; label: string }[] {
  if (role === 'ADMIN') {
    return [
      { href: '/platform/admin', label: 'Administration' },
      { href: '/', label: 'Workspace' },
    ];
  }
  if (role === 'INSTRUCTOR') {
    return [
      { href: '/platform/instructor', label: 'My courses' },
      { href: '/', label: 'Workspace' },
    ];
  }
  if (role === 'RESEARCHER') {
    // No workspace link: a researcher has no course to author, and showing a
    // door they may not walk through is worse than not showing it.
    return [{ href: '/platform/researcher', label: 'My studies' }];
  }
  return [{ href: '/platform/student', label: 'My courses' }];
}

export function PlatformShell({
  me,
  title,
  children,
}: {
  me: Me;
  title?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const links = linksFor(me.role);

  // Five open tabs were all called "OpenMAIC" (S3-7).
  useEffect(() => {
    document.title = title ? `${title} · OpenMAIC` : 'OpenMAIC';
  }, [title]);

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/platform" className="font-semibold">
            OpenMAIC
          </Link>
          <Badge variant="secondary" className="shrink-0">
            {me.role}
          </Badge>

          <nav className="flex items-center gap-1" aria-label="Platform">
            {links.map((l) => (
              <Button
                key={l.href}
                size="sm"
                variant={pathname === l.href ? 'secondary' : 'ghost'}
                asChild
              >
                <Link href={l.href}>{l.label}</Link>
              </Button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* Hidden on a phone, where it used to wrap across the role chip. */}
            <span className="text-muted-foreground hidden truncate text-sm sm:inline">
              {me.displayName ?? me.email}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await supabaseBrowser().auth.signOut();
                router.replace('/platform/login');
                router.refresh();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
