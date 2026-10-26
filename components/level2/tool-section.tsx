'use client';
/**
 * A Level-3 tool the instructor opens when they want it.
 *
 * The instructor page used to render Shared modules, Rubrics and assessment,
 * and Knowledge resources all expanded, all the time: three sections and
 * fourteen input controls sitting under the course list whether or not anyone
 * was using them. Somebody arriving to look at their classes had to scroll
 * past the machinery of three subsystems first.
 *
 * Closed by default, and the summary line says what the tool is for, so the
 * page reads as "my courses, and here are the tools" rather than as a wall.
 * The remembered state is per browser and deliberately shallow — a convenience,
 * not something the platform depends on.
 */
import { ChevronRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export function ToolSection({
  id,
  title,
  summary,
  children,
}: {
  /** Stable key for remembering whether this one was left open. */
  id: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Reading storage during render would differ between server and client, so
  // the first paint is always closed and the remembered state arrives after.
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(`openmaic.tool.${id}`) === 'open');
    } catch {
      // Private windows and blocked site data throw here. Closed is fine.
    }
  }, [id]);

  function toggle(next: boolean) {
    setOpen(next);
    try {
      window.localStorage.setItem(`openmaic.tool.${id}`, next ? 'open' : 'closed');
    } catch {
      // Not remembering is not a failure.
    }
  }

  return (
    <Collapsible open={open} onOpenChange={toggle} className="mt-4">
      <CollapsibleTrigger className="ring-foreground/10 bg-card hover:bg-muted/50 flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left ring-1 transition-colors">
        <ChevronRight
          className={`text-muted-foreground h-4 w-4 shrink-0 transition-transform ${
            open ? 'rotate-90' : ''
          }`}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="text-muted-foreground block text-xs">{summary}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}
