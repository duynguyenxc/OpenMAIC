'use client';
/**
 * Level 3A — the researcher's view.
 *
 * Deliberately narrow. A researcher sees the studies they lead or were added
 * to, the sections in them, how complete the data are, and an export — and
 * nothing else. *"Researcher should NOT automatically be able to modify
 * courses."* There is no course control on this page and no server route that
 * would accept one from this role.
 *
 * Participants appear by their research id. The link back to a person exists
 * in one table, behind an administrator check, and never reaches this screen.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlatformShell } from '@/components/level2/platform-shell';
import { useMe, useRoleGuard } from '@/lib/level2/use-platform';

interface Study {
  id: string;
  title: string;
  description: string | null;
  status: string;
  protocolIdentifier: string | null;
  principalInvestigator: string | null;
  courses: string;
  participants: string;
  consented: string;
  events: string;
}
interface StudyCourse {
  stageId: string;
  title: string;
  condition: string | null;
  cohort: string | null;
  institution: string | null;
  templateTitle: string | null;
  templateVersion: string | null;
  hasSnapshot: boolean;
  students: string;
  events: string;
}
interface Quality {
  rows: number;
  participants: number;
  courses: number;
  checks: Array<{ check: string; failures: number; detail?: string }>;
  excluded: { participantsWithoutConsent: number; eventsWithoutParticipant: number };
}

export default function ResearcherDashboard() {
  const router = useRouter();
  const me = useMe();
  const [studies, setStudies] = useState<Study[] | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const [courses, setCourses] = useState<StudyCourse[] | null>(null);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me === null) router.replace('/platform/login');
  }, [me, router]);
  // An administrator is allowed here: they may lead or oversee a study, and the
  // studies route answers them in full.
  useRoleGuard(me, ['RESEARCHER', 'ADMIN']);

  const load = useCallback(() => {
    fetch('/api/level2/me', { credentials: 'same-origin' }).then(() =>
      fetch('/api/level3/studies', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : { studies: [] }))
        .then((d) => setStudies(d.studies)),
    );
  }, []);
  useEffect(load, [load]);

  async function openStudy(id: string) {
    setOpen(id);
    setQuality(null);
    setCourses(null);
    const r = await fetch(`/api/level3/studies/${id}/courses`, { credentials: 'same-origin' });
    setCourses(r.ok ? (await r.json()).courses : []);
  }

  async function run(id: string, what: 'project' | 'quality') {
    setBusy(true);
    if (what === 'project') {
      const r = await fetch(`/api/level3/studies/${id}/project`, {
        method: 'POST', credentials: 'same-origin',
      });
      const d = await r.json().catch(() => ({}));
      setNote(
        r.ok
          ? `Rebuilt from OpenMAIC's own records: ${d.total.written} new event${d.total.written === 1 ? '' : 's'} from ${d.total.examined} examined${d.total.skippedUnmapped ? `, ${d.total.skippedUnmapped} of a kind we do not map yet` : ''}.`
          : 'That did not work.',
      );
      load();
      await openStudy(id);
    } else {
      // Open the study as well: the report used to render only when the
      // sections panel happened to be open, so pressing the button on a
      // closed card appeared to do nothing.
      setOpen(id);
      const r = await fetch(`/api/level3/studies/${id}/export?format=json`, { credentials: 'same-origin' });
      const d = await r.json().catch(() => ({}));
      setQuality(r.ok ? d.quality : null);
      setNote(r.ok ? null : 'The export could not be read.');
      if (r.ok && !courses) {
        const c = await fetch(`/api/level3/studies/${id}/courses`, { credentials: 'same-origin' });
        setCourses(c.ok ? (await c.json()).courses : []);
      }
    }
    setBusy(false);
  }

  if (!me) return <main className="text-muted-foreground p-6 text-sm">Loading…</main>;

  return (
    <PlatformShell me={me} title="My studies">
      <h1 className="mb-1 text-xl font-semibold">My studies</h1>
      <p className="text-muted-foreground mb-4 text-sm">
        Studies you lead or have been added to. Participants appear by their research identifier;
        this page never shows who they are.
      </p>

      {note && (
        <p role="alert" className="bg-muted mb-3 rounded-md px-3 py-2 text-sm">
          {note}
        </p>
      )}

      {studies === undefined && <p className="text-muted-foreground text-sm">Loading…</p>}
      {studies?.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            You are not on any study yet. An administrator creates studies and adds researchers to
            them.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {studies?.map((s) => (
          <Card key={s.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{s.title}</CardTitle>
                  <p className="text-muted-foreground text-xs">
                    {s.protocolIdentifier ?? 'no protocol id'} ·{' '}
                    {s.principalInvestigator ?? 'no principal investigator'}
                  </p>
                </div>
                <Badge variant={s.status === 'ACTIVE' ? 'default' : 'secondary'}>{s.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>
                  <strong className="text-foreground">{s.courses}</strong> course sections
                </span>
                <span>
                  <strong className="text-foreground">{s.participants}</strong> participants
                </span>
                <span>
                  <strong className="text-foreground">{s.consented}</strong> consented
                </span>
                <span>
                  <strong className="text-foreground">{s.events}</strong> recorded events
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void openStudy(s.id)}>
                  {open === s.id ? 'Sections shown' : 'Show sections'}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(s.id, 'project')}>
                  {busy ? 'Working…' : 'Rebuild events'}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(s.id, 'quality')}>
                  Check data quality
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/level3/studies/${s.id}/export?format=csv`}>Export CSV</a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/level3/studies/${s.id}/export?format=json`}>Export JSON</a>
                </Button>
              </div>

              {open === s.id && courses && (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground border-b text-left">
                      <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:whitespace-nowrap">
                        <th>Section</th><th>Institution</th><th>Condition</th><th>Cohort</th>
                        <th>Template</th><th>Students</th><th>Events</th><th>Snapshot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {courses.map((c) => (
                        <tr key={c.stageId} className="border-b last:border-0 [&>td]:px-3 [&>td]:py-2">
                          <td>
                            {c.title}
                            <div className="text-muted-foreground font-mono text-xs">{c.stageId}</div>
                          </td>
                          <td>{c.institution ?? '—'}</td>
                          <td>{c.condition ?? <span className="text-destructive">missing</span>}</td>
                          <td>{c.cohort ?? '—'}</td>
                          <td className="text-xs">
                            {c.templateTitle ? `${c.templateTitle} v${c.templateVersion}` : '—'}
                          </td>
                          <td>{c.students}</td>
                          <td>{c.events}</td>
                          <td>{c.hasSnapshot ? 'yes' : <span className="text-destructive">no</span>}</td>
                        </tr>
                      ))}
                      {courses.length === 0 && (
                        <tr><td colSpan={8} className="text-muted-foreground px-3 py-4">
                          No sections have been added to this study yet.
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {quality && open === s.id && (
                <div className="bg-muted/40 rounded-md p-3 text-sm">
                  <strong>Data quality</strong>
                  <p className="text-muted-foreground mb-2 text-xs">
                    {quality.rows} exportable rows · {quality.participants} participants ·{' '}
                    {quality.courses} sections. Excluded:{' '}
                    {quality.excluded.participantsWithoutConsent} participant(s) without consent.
                  </p>
                  <ul className="space-y-1">
                    {quality.checks.map((c) => (
                      <li key={c.check} className="flex items-start gap-2">
                        <span className={c.failures === 0 ? 'text-emerald-600' : 'text-destructive'}>
                          {c.failures === 0 ? '✓' : `✕ ${c.failures}`}
                        </span>
                        <span>
                          {c.check}
                          {c.detail && (
                            <span className="text-muted-foreground block text-xs">{c.detail}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </PlatformShell>
  );
}
