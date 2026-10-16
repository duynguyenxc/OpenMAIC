'use client';
/** Level 2 — the frame every dashboard shares. */
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabaseBrowser } from '@/lib/level2/supabase-browser';
import type { Me } from '@/lib/level2/use-platform';

export function PlatformShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold">OpenMAIC</span>
          <Badge variant="secondary">{me.role}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm">{me.displayName ?? me.email}</span>
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
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
