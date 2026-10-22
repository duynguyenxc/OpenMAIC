'use client';
/**
 * Level 3C — knowledge sources and bounded agents, from an instructor's side.
 *
 * The screen makes two things visible that are easy to get wrong in words:
 *
 * - **a source is yours to name.** The platform stores `authoritative`,
 *   `counterpoint`, `K1` or anything else and never interprets it, because
 *   *"Do not hard-code the labels K1 and K2 into the generic platform."*
 * - **a bound is enforced, not requested.** An agent restricted to one
 *   resource consults one resource, and the provenance afterwards proves it
 *   rather than the prompt promising it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { CourseSummary } from '@/lib/level2/use-platform';

interface Resource {
  id: string; title: string; type: string; version: string; visibility: string;
  documents: string; chunks: string; embedded: string; edges: string; ownerEmail: string;
}
interface Attached {
  attachmentId: string; resourceId: string; resourceTitle: string; resourceType: string;
  sourceName: string; sourceRole: string | null; priority: number;
}
interface Agent {
  id: string; name: string; version: string; agentRole: string | null;
  prohibitedBehavior: string | null; permittedResources: string[] | null; usedBy: string;
}

const TYPE_HELP: Record<string, string> = {
  DOCUMENT_COLLECTION: 'searched by keyword',
  VECTOR_INDEX: 'searched by meaning — chunks are embedded on upload',
  KNOWLEDGE_GRAPH: 'facts as subject–predicate–object, searched by either end',
  STRUCTURED_DATA: 'searched by keyword',
};

export function KnowledgePanel({ courses }: { courses: CourseSummary[] | undefined }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [course, setCourse] = useState('');
  const [attached, setAttached] = useState<Attached[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('DOCUMENT_COLLECTION');
  const [ingestInto, setIngestInto] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const [attachResource, setAttachResource] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceRole, setSourceRole] = useState('');

  const load = useCallback(() => {
    fetch('/api/level3/knowledge', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { resources: [] })).then((d) => setResources(d.resources));
    fetch('/api/level3/agents', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { agents: [] })).then((d) => setAgents(d.agents));
  }, []);
  useEffect(load, [load]);

  const loadAttached = useCallback(async (stageId: string) => {
    if (!stageId) return setAttached([]);
    const r = await fetch(`/api/level3/courses/${stageId}/knowledge`, { credentials: 'same-origin' });
    setAttached(r.ok ? (await r.json()).sources : []);
  }, []);

  async function send(url: string, init: RequestInit, success: (d: Record<string, unknown>) => string) {
    if (busy) return null;
    setBusy(true);
    setNote(null); // the previous answer is not this request's answer (O3)
    const res = await fetch(url, { credentials: 'same-origin', ...init });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setNote(res.ok ? success(data)
      : String((data.error as { message?: string } | undefined)?.message ?? 'That did not work.'));
    setBusy(false);
    return res.ok ? data : null;
  }
  const post = (body: unknown): RequestInit => ({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Knowledge sources and agents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          A course can draw on several sources at once. You name them; the platform keeps the name,
          the order and a record of every passage a model was actually given.
        </p>

        {note && <p role="alert" className="bg-muted rounded-md px-3 py-2 text-sm">{note}</p>}

        {/* ── Create a resource ──────────────────────────────────────────── */}
        <div className="rounded-md border p-3">
          <p className="mb-2 text-sm font-medium">New knowledge resource</p>
          <form className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send('/api/level3/knowledge', post({ title: newTitle, type: newType }),
                (d) => `Created “${String(d.title)}” — ${TYPE_HELP[newType]}.`)
                .then((d) => { if (d) { setNewTitle(''); load(); } });
            }}>
            <Input className="max-w-xs" placeholder="Policy corpus" value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)} aria-label="Resource title" />
            <select className="border-input bg-background rounded-md border px-2 py-1 text-sm"
              value={newType} onChange={(e) => setNewType(e.target.value)} aria-label="Resource type">
              {Object.keys(TYPE_HELP).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button size="sm" type="submit" disabled={busy || !newTitle.trim()}>Create</Button>
            <p className="text-muted-foreground w-full text-xs">{TYPE_HELP[newType]}</p>
          </form>
        </div>

        {/* ── Resources ──────────────────────────────────────────────────── */}
        <div className="divide-y rounded-md border">
          {resources.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {r.title} <span className="text-muted-foreground">v{r.version}</span>
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {r.documents} document(s) · {r.chunks} chunk(s)
                  {r.type === 'VECTOR_INDEX' && ` · ${r.embedded} embedded`}
                  {r.type === 'KNOWLEDGE_GRAPH' && ` · ${r.edges} fact(s)`}
                  {Number(r.chunks) > 0 && Number(r.embedded) === 0 && r.type === 'VECTOR_INDEX' && (
                    <span className="text-destructive"> · nothing embedded, so it is searched by keyword only</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{r.type}</Badge>
                <Button size="sm" variant="outline"
                  onClick={() => setIngestInto(ingestInto === r.id ? '' : r.id)}>
                  {ingestInto === r.id ? 'Close' : 'Add content'}
                </Button>
              </div>

              {ingestInto === r.id && (
                <form className="w-full space-y-2 border-t pt-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const body = r.type === 'KNOWLEDGE_GRAPH'
                      ? { edges: docContent.split('\n').map((line) => {
                            const [subject, predicate, object] = line.split('|').map((x) => x?.trim());
                            return subject && predicate && object ? { subject, predicate, object } : null;
                          }).filter(Boolean) }
                      : { title: docTitle, content: docContent };
                    void send(`/api/level3/knowledge/${r.id}/documents`, post(body),
                      (d) => r.type === 'KNOWLEDGE_GRAPH'
                        ? `${String(d.edgesWritten)} fact(s) added.`
                        : `“${String(d.title)}” added: ${String(d.chunks)} chunk(s), ${String(d.searchable)}.`)
                      .then((d) => { if (d) { setDocTitle(''); setDocContent(''); load(); } });
                  }}>
                  {r.type !== 'KNOWLEDGE_GRAPH' && (
                    <Input placeholder="Document title" value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)} aria-label="Document title" />
                  )}
                  <Textarea rows={4} value={docContent} onChange={(e) => setDocContent(e.target.value)}
                    aria-label="Content"
                    placeholder={r.type === 'KNOWLEDGE_GRAPH'
                      ? 'One fact per line:  subject | predicate | object'
                      : 'Paste the text. Blank lines separate chunks.'} />
                  <Button size="sm" type="submit" disabled={busy || !docContent.trim()}>
                    {busy ? 'Working…' : 'Add'}
                  </Button>
                </form>
              )}
            </div>
          ))}
          {resources.length === 0 && (
            <p className="text-muted-foreground px-3 py-4 text-sm">No knowledge resources yet.</p>
          )}
        </div>

        {/* ── Attach to a course ─────────────────────────────────────────── */}
        <div className="rounded-md border p-3">
          <p className="mb-2 text-sm font-medium">Give a course its sources</p>
          <form className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(`/api/level3/courses/${course}/knowledge`,
                post({ resourceId: attachResource, sourceName, sourceRole: sourceRole || undefined }),
                () => `“${sourceName}” is now one of this course's sources.`)
                .then((d) => { if (d) { setSourceName(''); setSourceRole(''); void loadAttached(course); } });
            }}>
            <select className="border-input bg-background max-w-xs rounded-md border px-2 py-1 text-sm"
              value={course} onChange={(e) => { setCourse(e.target.value); void loadAttached(e.target.value); }}
              aria-label="Course">
              <option value="">Choose a course…</option>
              {(courses ?? []).map((c) => <option key={c.stageId} value={c.stageId}>{c.title}</option>)}
            </select>
            <select className="border-input bg-background max-w-xs rounded-md border px-2 py-1 text-sm"
              value={attachResource} onChange={(e) => setAttachResource(e.target.value)}
              aria-label="Resource">
              <option value="">Choose a resource…</option>
              {resources.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <Input className="max-w-[12rem]" placeholder="authoritative" value={sourceName}
              onChange={(e) => setSourceName(e.target.value)} aria-label="Source name" />
            <Input className="max-w-[14rem]" placeholder="what it is for" value={sourceRole}
              onChange={(e) => setSourceRole(e.target.value)} aria-label="Source role" />
            <Button size="sm" type="submit" disabled={busy || !course || !attachResource || !sourceName.trim()}>
              Attach
            </Button>
            <p className="text-muted-foreground w-full text-xs">
              The name is yours. Nothing in the platform assumes a particular set of labels.
            </p>
          </form>

          {course && attached.length > 0 && (
            <div className="mt-2 divide-y rounded-md border">
              {attached.map((a) => (
                <div key={a.attachmentId} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>
                    <strong>{a.sourceName}</strong>
                    {a.sourceRole ? <span className="text-muted-foreground"> — {a.sourceRole}</span> : null}
                    <span className="text-muted-foreground block text-xs">
                      {a.resourceTitle} · {a.resourceType} · priority {a.priority}
                    </span>
                  </span>
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => void send(
                      `/api/level3/courses/${course}/knowledge?sourceName=${encodeURIComponent(a.sourceName)}`,
                      { method: 'DELETE' }, () => `“${a.sourceName}” detached.`)
                      .then((d) => { if (d) void loadAttached(course); })}>
                    Detach
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Agents ─────────────────────────────────────────────────────── */}
        <div className="rounded-md border p-3">
          <p className="mb-1 text-sm font-medium">Agent configurations</p>
          <p className="text-muted-foreground mb-2 text-xs">
            An agent limited to certain resources consults only those, and the record afterwards
            shows it. That is how a bounded condition differs from a polite request in a prompt.
          </p>
          <div className="divide-y rounded-md border">
            {agents.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <strong>{a.name}</strong> <span className="text-muted-foreground">v{a.version}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {a.agentRole ?? 'no role set'} ·{' '}
                    {a.permittedResources?.length
                      ? `bounded to ${a.permittedResources.length} resource(s)`
                      : 'unbounded — may use every attached source'}
                    {' '}· used by {a.usedBy} section(s)
                  </span>
                </span>
                <Button size="sm" variant="outline" disabled={busy || !course}
                  onClick={() => void send('/api/level3/agents',
                    { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ stageId: course, agentConfigurationId: a.id }) },
                    () => `This course now runs under “${a.name}” v${a.version}.`)
                    .then((d) => { if (d) load(); })}>
                  Use for the chosen course
                </Button>
              </div>
            ))}
            {agents.length === 0 && (
              <p className="text-muted-foreground px-3 py-4 text-sm">
                No agent configurations yet. They are created through the API in this release.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
