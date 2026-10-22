'use client';
/**
 * Level 3A — the administrator's research controls.
 *
 * Institutions and studies are platform administration, so they live on the
 * administrator's page rather than the researcher's: *"Admin functions: create
 * institutions; ... create/approve studies; associate courses with studies."*
 * A researcher reads a study; only an administrator brings one into existence
 * and decides which sections are in it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { CourseSummary } from '@/lib/level2/use-platform';

interface Institution {
  id: string; name: string; shortName: string; country: string | null;
  status: string; members: string; courses: string;
}
interface Study {
  id: string; title: string; status: string; protocolIdentifier: string | null;
  principalInvestigator: string | null; courses: string; participants: string;
  consented: string; events: string;
}

export function ResearchAdmin({ courses }: { courses: CourseSummary[] | undefined }) {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [studies, setStudies] = useState<Study[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [instName, setInstName] = useState('');
  const [instShort, setInstShort] = useState('');
  const [studyTitle, setStudyTitle] = useState('');
  const [studyPi, setStudyPi] = useState('');
  const [studyProtocol, setStudyProtocol] = useState('');

  const [attachTo, setAttachTo] = useState<string | null>(null);
  const [attachCourse, setAttachCourse] = useState('');
  const [attachCondition, setAttachCondition] = useState('');
  const [participantEmail, setParticipantEmail] = useState('');
  const [participantConsent, setParticipantConsent] = useState('CONSENTED');

  const load = useCallback(() => {
    fetch('/api/level3/institutions', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { institutions: [] }))
      .then((d) => setInstitutions(d.institutions));
    fetch('/api/level3/studies', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { studies: [] }))
      .then((d) => setStudies(d.studies));
  }, []);
  useEffect(load, [load]);

  /**
   * Returns whether the server accepted it. Every form here used to clear
   * itself in a `.then` that ran on refusal too, so a rejected institution or
   * study took the typing with it and had to be entered again (O2).
   */
  /** Same contract as `post`, for the verbs that are not POST. */
  async function send(url: string, method: string, body: unknown, success: string) {
    if (busy) return false;
    setBusy(true);
    setNote(null);
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json().catch(() => ({}))) as
      { error?: { message?: string }; message?: string };
    setNote(res.ok ? (data.message ?? success) : (data.error?.message ?? 'That did not work.'));
    if (res.ok) load();
    setBusy(false);
    return res.ok;
  }

  async function post(url: string, body: unknown, success: string) {
    if (busy) return false;
    setBusy(true);
    setNote(null); // the previous answer is not this request's answer (O3)
    const res = await fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    setNote(res.ok ? success : (data.error?.message ?? 'That did not work.'));
    if (res.ok) load();
    setBusy(false);
    return res.ok;
  }

  return (
    <>
      {/* Reserved, not collapsed: see O4. */}
      <div className="mb-3 min-h-9">
        {note && <p role="alert" className="bg-muted rounded-md px-3 py-2 text-sm">{note}</p>}
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Institutions ({institutions.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Institutions group people and sections. They never grant access to a course — course
            permission stays with ownership and enrolment.
          </p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void post('/api/level3/institutions', { name: instName, shortName: instShort },
                `Added ${instName}.`).then((ok) => { if (ok) { setInstName(''); setInstShort(''); } });
            }}
          >
            <Input className="max-w-xs" placeholder="Jackson State University"
              value={instName} onChange={(e) => setInstName(e.target.value)}
              aria-label="Institution name" />
            <Input className="max-w-[10rem]" placeholder="JSU"
              value={instShort} onChange={(e) => setInstShort(e.target.value)}
              aria-label="Short name" />
            <Button type="submit" disabled={busy || !instName.trim() || !instShort.trim()}>
              {busy ? 'Working…' : 'Add institution'}
            </Button>
          </form>
          <div className="divide-y rounded-md border">
            {institutions.map((i) => (
              <div key={i.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>
                  {i.name} <span className="text-muted-foreground">({i.shortName})</span>
                  <span className="text-muted-foreground block text-xs">
                    {i.country ?? '—'} · {i.members} member(s) · {i.courses} course(s)
                  </span>
                </span>
                <Badge variant={i.status === 'ACTIVE' ? 'default' : 'secondary'}>{i.status}</Badge>
              </div>
            ))}
            {institutions.length === 0 && (
              <p className="text-muted-foreground px-3 py-4 text-sm">No institutions yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Studies ({studies.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void post('/api/level3/studies',
                { title: studyTitle, principalInvestigator: studyPi || undefined,
                  protocolIdentifier: studyProtocol || undefined },
                `Created “${studyTitle}”.`)
                .then((ok) => { if (ok) { setStudyTitle(''); setStudyPi(''); setStudyProtocol(''); } });
            }}
          >
            <Input className="max-w-sm" placeholder="Study title"
              value={studyTitle} onChange={(e) => setStudyTitle(e.target.value)}
              aria-label="Study title" />
            <Input className="max-w-xs" type="email" placeholder="principal investigator email"
              value={studyPi} onChange={(e) => setStudyPi(e.target.value)}
              aria-label="Principal investigator email" />
            <Input className="max-w-[12rem]" placeholder="PROTO-2026-001"
              value={studyProtocol} onChange={(e) => setStudyProtocol(e.target.value)}
              aria-label="Protocol identifier" />
            <Button type="submit" disabled={busy || !studyTitle.trim()}>
              {busy ? 'Working…' : 'Create study'}
            </Button>
          </form>

          <div className="space-y-2">
            {studies.map((s) => (
              <div key={s.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <strong>{s.title}</strong>
                    <span className="text-muted-foreground block text-xs">
                      {s.protocolIdentifier ?? 'no protocol id'} ·{' '}
                      {s.principalInvestigator ?? 'no principal investigator'} · {s.courses} section(s) ·{' '}
                      {s.consented}/{s.participants} consented · {s.events} event(s)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* A study was DRAFT for ever: nothing could move it to
                        ACTIVE and nothing could remove one made by mistake
                        (O6). The badge is now the control. */}
                    <select
                      className="border-input bg-background rounded-md border px-2 py-1 text-xs"
                      value={s.status}
                      disabled={busy}
                      onChange={(e) =>
                        void send(`/api/level3/studies/${s.id}`, 'PATCH',
                          { status: e.target.value },
                          `“${s.title}” is now ${e.target.value.toLowerCase()}.`)
                      }
                      aria-label={`Status of ${s.title}`}
                    >
                      {['DRAFT', 'ACTIVE', 'CLOSED'].map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline"
                      onClick={() => setAttachTo(attachTo === s.id ? null : s.id)}>
                      {attachTo === s.id ? 'Close' : 'Manage'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => {
                        // Participants and events cascade from a study, so the
                        // server closes rather than deletes when it holds any,
                        // and says so. The warning here only has to be honest
                        // about which of the two is about to happen.
                        const holdsData = Number(s.participants) > 0 || Number(s.events) > 0;
                        const question = holdsData
                          ? `“${s.title}” holds ${s.participants} participant record(s) and ` +
                            `${s.events} event(s). It will be closed, not deleted, and nothing ` +
                            'will be destroyed. Continue?'
                          : `“${s.title}” holds no participants and no events, so it will be ` +
                            'deleted permanently. This cannot be undone. Continue?';
                        if (!window.confirm(question)) return;
                        void send(`/api/level3/studies/${s.id}`, 'DELETE', {},
                          `“${s.title}” was removed.`);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                {attachTo === s.id && (
                  <div className="mt-3 space-y-3 border-t pt-3">
                    <div>
                      <p className="mb-1 text-xs font-medium">Add a course section to this study</p>
                      <form
                        className="flex flex-wrap gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void post(`/api/level3/studies/${s.id}/courses`,
                            { stageId: attachCourse, condition: attachCondition || undefined },
                            `Added the section under ${attachCondition || 'no condition'}.`)
                            .then((ok) => { if (ok) { setAttachCourse(''); setAttachCondition(''); } });
                        }}
                      >
                        <select
                          className="border-input bg-background max-w-xs rounded-md border px-2 py-1 text-sm"
                          value={attachCourse} onChange={(e) => setAttachCourse(e.target.value)}
                          aria-label="Course section"
                        >
                          <option value="">Choose a section…</option>
                          {(courses ?? []).map((c) => (
                            <option key={c.stageId} value={c.stageId}>
                              {c.title} — {c.ownerEmail}
                            </option>
                          ))}
                        </select>
                        <Input className="max-w-[14rem]" placeholder="CONDITION-A"
                          value={attachCondition} onChange={(e) => setAttachCondition(e.target.value)}
                          aria-label="Experimental condition" />
                        <Button size="sm" type="submit" disabled={busy || !attachCourse}>Add section</Button>
                      </form>
                      <p className="text-muted-foreground mt-1 text-xs">
                        Condition labels are yours to choose; nothing in the platform assumes a
                        particular set.
                      </p>
                    </div>

                    <div>
                      <p className="mb-1 text-xs font-medium">Register a participant and record consent</p>
                      <form
                        className="flex flex-wrap gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void post(`/api/level3/studies/${s.id}/participants`,
                            { email: participantEmail, consentStatus: participantConsent },
                            'Recorded, as a participant identifier rather than a name.')
                            .then((ok) => { if (ok) setParticipantEmail(''); });
                        }}
                      >
                        <Input className="max-w-xs" type="email" placeholder="student@example.test"
                          value={participantEmail} onChange={(e) => setParticipantEmail(e.target.value)}
                          aria-label="Participant account email" />
                        <select
                          className="border-input bg-background rounded-md border px-2 py-1 text-sm"
                          value={participantConsent}
                          onChange={(e) => setParticipantConsent(e.target.value)}
                          aria-label="Consent status"
                        >
                          {['CONSENTED', 'PENDING', 'NOT_REQUESTED', 'DECLINED', 'WITHDRAWN'].map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <Button size="sm" type="submit" disabled={busy || !participantEmail.trim()}>
                          Record
                        </Button>
                      </form>
                      <p className="text-muted-foreground mt-1 text-xs">
                        Only consented participants appear in an export. Using the platform for a
                        course and being in a dataset are separate things.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {studies.length === 0 && <p className="text-muted-foreground text-sm">No studies yet.</p>}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
