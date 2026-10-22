'use client';
/**
 * Level 3A — the shared module library, from an instructor's side.
 *
 * Two acts, and they are not the same one. **Publishing** says "this
 * instructional design of mine may be reused", at a version, with a visibility
 * that decides who may see it. **Cloning** takes somebody's published design
 * and makes a section of your own from it.
 *
 * What cloning does *not* take is the point of the whole level: no students,
 * no learner records, no results. The copy is a new course with a new id,
 * owned by whoever cloned it, and the server guarantees that by cloning
 * through OpenMAIC's document store rather than by copying rows.
 *
 * Students never see this. *"Students do not browse instructor template
 * libraries."*
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { CourseSummary } from '@/lib/level2/use-platform';

interface Template {
  id: string;
  title: string;
  description: string | null;
  version: string;
  visibility: string;
  discipline: string | null;
  createdByEmail: string;
  createdByName: string | null;
  institution: string | null;
  clonedInto: string;
}

const VISIBILITY_HELP: Record<string, string> = {
  PRIVATE: 'only you',
  INSTITUTION: 'anyone at your institution',
  COMMUNITY: 'every instructor on the platform',
  ADMIN_ONLY: 'administrators only',
};

export function TemplateLibrary({
  courses,
  onChanged,
}: {
  courses: CourseSummary[] | undefined;
  onChanged: () => void;
}) {
  const [templates, setTemplates] = useState<Template[] | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const [sourceCourse, setSourceCourse] = useState('');
  const [version, setVersion] = useState('1.0');
  const [visibility, setVisibility] = useState('COMMUNITY');

  const load = useCallback(() => {
    fetch('/api/level3/templates', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => setTemplates(d.templates));
  }, []);
  useEffect(load, [load]);

  async function send(url: string, body: unknown, success: (d: Record<string, unknown>) => string) {
    if (busy) return;
    setBusy(true);
    setNote(null); // the previous answer is not this request's answer (O3)
    const res = await fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setNote(
      res.ok
        ? success(data)
        : String((data.error as { message?: string } | undefined)?.message ?? 'That did not work.'),
    );
    if (res.ok) { load(); onChanged(); }
    setBusy(false);
  }

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            Shared modules{templates ? ` (${templates.length})` : ''}
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
            {open ? 'Close' : 'Publish one of my courses'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">
          A module you clone becomes a course of your own: a new id, your ownership, an empty roll.
          No student work is ever copied.
        </p>

        {note && <p role="alert" className="bg-muted rounded-md px-3 py-2 text-sm">{note}</p>}

        {open && (
          <form
            className="flex flex-wrap items-center gap-2 rounded-md border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send('/api/level3/templates',
                { stageId: sourceCourse, version, visibility },
                (d) => `Published “${String(d.title)}” v${String(d.version)}, visible to ${VISIBILITY_HELP[visibility]}.`,
              ).then(() => setSourceCourse(''));
            }}
          >
            <select
              className="border-input bg-background max-w-xs rounded-md border px-2 py-1 text-sm"
              value={sourceCourse} onChange={(e) => setSourceCourse(e.target.value)}
              aria-label="Course to publish"
            >
              <option value="">Choose one of my courses…</option>
              {(courses ?? []).map((c) => (
                <option key={c.stageId} value={c.stageId}>{c.title}</option>
              ))}
            </select>
            <Input className="max-w-[7rem]" value={version} onChange={(e) => setVersion(e.target.value)}
              aria-label="Version" placeholder="1.0" />
            <select
              className="border-input bg-background rounded-md border px-2 py-1 text-sm"
              value={visibility} onChange={(e) => setVisibility(e.target.value)}
              aria-label="Visibility"
            >
              {Object.keys(VISIBILITY_HELP).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <Button size="sm" type="submit" disabled={busy || !sourceCourse}>
              {busy ? 'Working…' : 'Publish'}
            </Button>
            <p className="text-muted-foreground w-full text-xs">
              Visible to {VISIBILITY_HELP[visibility]}. Raise the version to publish a changed
              design — a study that is running must keep pointing at the version it started with.
            </p>
          </form>
        )}

        <div className="divide-y rounded-md border">
          {templates?.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {t.title} <span className="text-muted-foreground">v{t.version}</span>
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {t.createdByName ?? t.createdByEmail}
                  {t.institution ? ` · ${t.institution}` : ''}
                  {t.discipline ? ` · ${t.discipline}` : ''} · used by {t.clonedInto} section(s)
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{t.visibility}</Badge>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void send(`/api/level3/templates/${t.id}/clone`, {},
                      (d) => `Created “${String(d.title)}” from ${t.title} v${t.version}. It has no students and no learner data.`)
                  }
                >
                  Use this module
                </Button>
              </div>
            </div>
          ))}
          {templates?.length === 0 && (
            <p className="text-muted-foreground px-3 py-4 text-sm">
              No shared modules yet. Publish one of your courses to let colleagues run it.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
