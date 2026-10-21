/**
 * Level 3C — put content into a resource.
 *
 * Documents are chunked and, for a VECTOR_INDEX, embedded. Embedding failures
 * are **not** fatal: the chunk is stored without a vector and the resource
 * reports how much of it is searchable, which is more useful than refusing
 * the ingest and leaving nothing.
 *
 * A KNOWLEDGE_GRAPH resource takes triples instead, which is the same act
 * through a different door.
 */
import { requireAuthenticatedUser } from '@/lib/level2/authorization';
import { level2Pool } from '@/lib/level2/db';
import { embedText } from '@/lib/level3/embeddings';
import { apiError, json, withOwner } from '@/lib/level2/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ resourceId: string }> };

/** Paragraph-ish chunks, bounded. Good enough for a prototype corpus, and
 *  honest about being simple rather than pretending to be a pipeline. */
function chunk(text: string, max = 1200): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length > max && current) { out.push(current); current = p; }
    else current = current ? `${current}\n\n${p}` : p;
  }
  if (current) out.push(current);
  return out.length ? out : [text.slice(0, max)];
}

export function POST(req: Request, { params }: Params): Promise<Response> {
  return withOwner(req, async (ownerId, headers) => {
    const { resourceId } = await params;
    const actor = await requireAuthenticatedUser(ownerId);
    const pool = await level2Pool();

    const { rows: resRows } = await pool.query(
      `SELECT id, type, owner_id AS "ownerId" FROM knowledge_resources WHERE id = $1`, [resourceId]);
    const resource = resRows[0] as { id: string; type: string; ownerId: string } | undefined;
    if (!resource) return apiError(404, 'RESOURCE_NOT_FOUND', 'no such resource', headers);
    if (resource.ownerId !== actor.profileId && actor.role !== 'ADMIN') {
      return apiError(403, 'FORBIDDEN', 'only the owner may add to this resource', headers);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // ── A graph takes triples ──
    if (resource.type === 'KNOWLEDGE_GRAPH') {
      const edges = Array.isArray(body.edges) ? (body.edges as Array<Record<string, unknown>>) : [];
      if (edges.length === 0) {
        return apiError(400, 'EDGES_REQUIRED', 'a knowledge graph resource takes edges', headers);
      }
      let written = 0;
      for (const e of edges) {
        if (typeof e.subject !== 'string' || typeof e.predicate !== 'string' || typeof e.object !== 'string') continue;
        await pool.query(
          `INSERT INTO knowledge_graph_edges (resource_id, subject, predicate, object, evidence)
           VALUES ($1, $2, $3, $4, $5)`,
          [resourceId, e.subject, e.predicate, e.object,
           typeof e.evidence === 'string' ? e.evidence : null],
        );
        written += 1;
      }
      return json({ resourceId, edgesWritten: written }, 201, headers);
    }

    // ── Everything else takes a document ──
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!title || !content) {
      return apiError(400, 'DOCUMENT_REQUIRED', 'a title and content are required', headers);
    }

    const { rows: docRows } = await pool.query(
      `INSERT INTO knowledge_documents (resource_id, external_id, title, source_uri, metadata)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [resourceId, body.externalId ?? null, title, body.sourceUri ?? null, body.metadata ?? null],
    );
    const documentId = (docRows[0] as { id: string }).id;

    const pieces = chunk(content);
    let embedded = 0;
    for (const [ordinal, piece] of pieces.entries()) {
      const vector = resource.type === 'VECTOR_INDEX' ? await embedText(piece) : null;
      if (vector) embedded += 1;
      await pool.query(
        `INSERT INTO knowledge_chunks (resource_id, document_id, ordinal, content, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)`,
        [resourceId, documentId, ordinal, piece, vector ? JSON.stringify(vector) : null],
      );
    }

    return json(
      {
        documentId, title, chunks: pieces.length, embedded,
        // Said plainly rather than left to be discovered: a VECTOR_INDEX whose
        // embeddings failed is searchable by keyword and not by meaning.
        searchable: resource.type === 'VECTOR_INDEX'
          ? (embedded === pieces.length ? 'by meaning' : embedded ? 'partly by meaning' : 'not by meaning — embedding failed')
          : 'by keyword',
      },
      201,
      headers,
    );
  });
}
