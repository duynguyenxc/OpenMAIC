/**
 * Level 3C — knowledge resources, and the interface everything retrieves
 * through.
 *
 * The instruction is unusually insistent here, and for a good reason:
 *
 *   "Create a clean abstraction: KnowledgeProvider.
 *    Possible implementations: DocumentRetriever, VectorRetriever,
 *    KnowledgeGraphRetriever.
 *    The learning agent should request context through this interface.
 *    Do not tightly couple OpenMAIC to one graph database."
 *
 * So nothing above this file knows what a vector is, what a triple is, or
 * what Neo4j is. A caller asks a **source** for context and gets passages
 * back with provenance attached. Replacing the store behind a provider — a
 * local table today, a GraphRAG service tomorrow — changes this file and
 * nothing else.
 *
 * Two more rules are honoured by construction rather than by promise:
 *
 * - *"Do not force all knowledge into a KG."* The graph is one provider among
 *   three, chosen by a resource's `type`, and a course can use none of it.
 * - *"Do not hard-code the labels K1 and K2."* A source carries whatever name
 *   the researcher gave it, and the platform never interprets that name.
 */
import { level2Pool } from '@/lib/level2/db';

export type ResourceType =
  | 'DOCUMENT_COLLECTION'
  | 'VECTOR_INDEX'
  | 'KNOWLEDGE_GRAPH'
  | 'STRUCTURED_DATA';

/** What a retriever hands back. Provenance travels **with** the text. */
export interface Passage {
  resourceId: string;
  resourceTitle: string;
  sourceName: string;
  sourceRole: string | null;
  provider: string;
  documentId: string | null;
  documentTitle: string | null;
  chunkId: string | null;
  edgeId: string | null;
  content: string;
  /** The retriever's own number, and nothing more. See the note on precision. */
  score: number | null;
}

export interface RetrievalRequest {
  query: string;
  limit: number;
}

/**
 * One source of knowledge, as the rest of the platform sees it.
 *
 * `retrieve` is the whole contract. Everything else — embeddings, trigrams,
 * triples, a remote graph service — is behind it.
 */
export interface KnowledgeProvider {
  readonly name: string;
  retrieve(source: AttachedSource, request: RetrievalRequest): Promise<Passage[]>;
}

/** A resource attached to something, with the researcher's own label on it. */
export interface AttachedSource {
  attachmentId: string;
  resourceId: string;
  resourceTitle: string;
  resourceType: ResourceType;
  sourceName: string;
  sourceRole: string | null;
  priority: number;
  retrievalPolicy: Record<string, unknown> | null;
}

// ───────────────────────── Providers ─────────────────────────

/**
 * Keyword retrieval over stored chunks.
 *
 * Trigram similarity rather than `LIKE`, so the score means something and a
 * gin index does the work. Honest about what it is: lexical overlap, not
 * understanding.
 */
export const DocumentRetriever: KnowledgeProvider = {
  name: 'DocumentRetriever',
  async retrieve(source, request) {
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT kc.id AS "chunkId", kc.content, kc.document_id AS "documentId",
              kd.title AS "documentTitle",
              similarity(kc.content, $2) AS score
         FROM knowledge_chunks kc
         JOIN knowledge_documents kd ON kd.id = kc.document_id
        WHERE kc.resource_id = $1
          AND (kc.content ILIKE '%' || $2 || '%' OR similarity(kc.content, $2) > 0.05)
        ORDER BY score DESC NULLS LAST, kc.ordinal
        LIMIT $3`,
      [source.resourceId, request.query, request.limit],
    );
    return (rows as Array<Record<string, any>>).map((r) => ({
      resourceId: source.resourceId,
      resourceTitle: source.resourceTitle,
      sourceName: source.sourceName,
      sourceRole: source.sourceRole,
      provider: 'DocumentRetriever',
      documentId: r.documentId,
      documentTitle: r.documentTitle,
      chunkId: r.chunkId,
      edgeId: null,
      content: r.content,
      score: r.score === null ? null : Number(r.score),
    }));
  },
};

/**
 * Vector retrieval, using pgvector and whatever embedding function is passed
 * in. The embedder is an argument rather than an import, so the provider does
 * not know or care which vendor produced the numbers.
 *
 * A chunk with no embedding is simply not found — a resource half-ingested
 * returns less rather than lying about what it has.
 */
export function makeVectorRetriever(
  embed: (text: string) => Promise<number[] | null>,
): KnowledgeProvider {
  return {
    name: 'VectorRetriever',
    async retrieve(source, request) {
      const vector = await embed(request.query);
      if (!vector) return [];
      const pool = await level2Pool();
      const { rows } = await pool.query(
        `SELECT kc.id AS "chunkId", kc.content, kc.document_id AS "documentId",
                kd.title AS "documentTitle",
                1 - (kc.embedding <=> $2::vector) AS score
           FROM knowledge_chunks kc
           JOIN knowledge_documents kd ON kd.id = kc.document_id
          WHERE kc.resource_id = $1 AND kc.embedding IS NOT NULL
          ORDER BY kc.embedding <=> $2::vector
          LIMIT $3`,
        [source.resourceId, JSON.stringify(vector), request.limit],
      );
      return (rows as Array<Record<string, any>>).map((r) => ({
        resourceId: source.resourceId,
        resourceTitle: source.resourceTitle,
        sourceName: source.sourceName,
        sourceRole: source.sourceRole,
        provider: 'VectorRetriever',
        documentId: r.documentId,
        documentTitle: r.documentTitle,
        chunkId: r.chunkId,
        edgeId: null,
        content: r.content,
        score: r.score === null ? null : Number(r.score),
      }));
    },
  };
}

/**
 * Graph retrieval.
 *
 * This implementation reads plain triples from a local table. It is **an**
 * implementation, not **the** one: the promise Level 3C makes is the
 * interface, and a Neo4j, GraphRAG or other structured service plugs in here
 * by replacing this object. Nothing above it would change, which is exactly
 * what *"Do not tightly couple OpenMAIC to one graph database"* asks for.
 *
 * A matched edge is returned as a sentence, because what a model can use is
 * text, and the edge id goes with it so provenance survives.
 */
export const KnowledgeGraphRetriever: KnowledgeProvider = {
  name: 'KnowledgeGraphRetriever',
  async retrieve(source, request) {
    const pool = await level2Pool();
    const { rows } = await pool.query(
      `SELECT id AS "edgeId", subject, predicate, object, evidence,
              document_id AS "documentId",
              greatest(similarity(subject, $2), similarity(object, $2)) AS score
         FROM knowledge_graph_edges
        WHERE resource_id = $1
          AND (subject ILIKE '%' || $2 || '%' OR object ILIKE '%' || $2 || '%'
               OR similarity(subject, $2) > 0.2 OR similarity(object, $2) > 0.2)
        ORDER BY score DESC NULLS LAST
        LIMIT $3`,
      [source.resourceId, request.query, request.limit],
    );
    return (rows as Array<Record<string, any>>).map((r) => ({
      resourceId: source.resourceId,
      resourceTitle: source.resourceTitle,
      sourceName: source.sourceName,
      sourceRole: source.sourceRole,
      provider: 'KnowledgeGraphRetriever',
      documentId: r.documentId,
      documentTitle: null,
      chunkId: null,
      edgeId: r.edgeId,
      content: `${r.subject} — ${r.predicate} — ${r.object}${r.evidence ? ` (${r.evidence})` : ''}`,
      score: r.score === null ? null : Number(r.score),
    }));
  },
};

/** A resource's type chooses its provider. Nothing else does. */
export function providerFor(
  type: ResourceType,
  embed: (text: string) => Promise<number[] | null>,
): KnowledgeProvider {
  switch (type) {
    case 'VECTOR_INDEX':
      return makeVectorRetriever(embed);
    case 'KNOWLEDGE_GRAPH':
      return KnowledgeGraphRetriever;
    case 'DOCUMENT_COLLECTION':
    case 'STRUCTURED_DATA':
    default:
      return DocumentRetriever;
  }
}

// ───────────────────────── Orchestration ─────────────────────────

/**
 * Every source attached to a course, and to the agent configuration it runs
 * under, in priority order.
 *
 * *"Design the system so a course/agent can use multiple knowledge resources
 * simultaneously."* Several sources is the normal case, not a special one,
 * and each keeps its own name and role so a researcher can tell which passage
 * came from the authoritative corpus and which from the counterpoint.
 */
export async function sourcesForCourse(stageId: string): Promise<AttachedSource[]> {
  const pool = await level2Pool();
  const { rows } = await pool.query(
    `SELECT ka.id AS "attachmentId", ka.resource_id AS "resourceId",
            kr.title AS "resourceTitle", kr.type AS "resourceType",
            ka.source_name AS "sourceName", ka.source_role AS "sourceRole",
            ka.priority, ka.retrieval_policy AS "retrievalPolicy"
       FROM knowledge_attachments ka
       JOIN knowledge_resources kr ON kr.id = ka.resource_id
       JOIN courses c ON c.openmaic_stage_id = $1
      WHERE kr.status <> 'ARCHIVED'
        AND (
          (ka.scope = 'COURSE'   AND ka.scope_id = $1)
          OR (ka.scope = 'TEMPLATE' AND ka.scope_id = c.template_id::text)
          OR (ka.scope = 'AGENT'    AND ka.scope_id = c.agent_configuration_id::text)
        )
      ORDER BY ka.priority, ka.source_name`,
    [stageId],
  );
  return rows as AttachedSource[];
}

export interface RetrievedContext {
  requestId: string;
  passages: Passage[];
  sources: Array<{ sourceName: string; resourceTitle: string; provider: string; passages: number }>;
}

/**
 * Ask every attached source for context, and record what came back.
 *
 * A failing source is skipped, not fatal: *"The student classroom must
 * continue functioning even if ... KG service is unavailable."* Degrading to
 * fewer sources is the behaviour; failing the whole request is not.
 *
 * The bound, when there is one, is the agent configuration's
 * `permitted_resources`. An agent restricted to one corpus is an experimental
 * condition, and the restriction is enforced here rather than suggested in a
 * prompt.
 */
export async function gatherContext(input: {
  stageId: string;
  query: string;
  purpose: string;
  perSourceLimit?: number;
  permittedResources?: string[] | null;
  courseId?: string | null;
  learnerId?: string | null;
  responseId?: string | null;
  embed: (text: string) => Promise<number[] | null>;
}): Promise<RetrievedContext> {
  const pool = await level2Pool();
  const { rows: idRow } = await pool.query(`SELECT gen_random_uuid() AS id`);
  const requestId = (idRow[0] as { id: string }).id;

  let sources = await sourcesForCourse(input.stageId);
  if (input.permittedResources && input.permittedResources.length > 0) {
    const allowed = new Set(input.permittedResources);
    sources = sources.filter((s) => allowed.has(s.resourceId));
  }

  const passages: Passage[] = [];
  const summary: RetrievedContext['sources'] = [];

  for (const source of sources) {
    const provider = providerFor(source.resourceType, input.embed);
    let found: Passage[] = [];
    try {
      const limit = Number(source.retrievalPolicy?.limit) || input.perSourceLimit || 3;
      found = await provider.retrieve(source, { query: input.query, limit });
    } catch (error) {
      console.error('[level3c] retrieval failed for', source.sourceName, error);
      found = [];
    }
    passages.push(...found);
    summary.push({
      sourceName: source.sourceName,
      resourceTitle: source.resourceTitle,
      provider: provider.name,
      passages: found.length,
    });

    for (const p of found) {
      await pool.query(
        `INSERT INTO retrieval_events
           (request_id, purpose, provider, resource_id, source_name, document_id, chunk_id,
            edge_id, score, query, course_id, learner_id, response_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [requestId, input.purpose, p.provider, p.resourceId, p.sourceName, p.documentId,
         p.chunkId, p.edgeId, p.score, input.query, input.courseId ?? null,
         input.learnerId ?? null, input.responseId ?? null],
      );
    }
  }

  return { requestId, passages, sources: summary };
}

/**
 * The retrieved context as text for a prompt.
 *
 * Each passage is labelled with the source's own name, so a model that cites
 * "the authoritative source" can be checked against what it was actually
 * given — and so a reader of the prompt can see which corpus said what.
 */
export function contextAsText(passages: Passage[]): string {
  if (passages.length === 0) return '';
  return passages
    .map(
      (p, i) =>
        `[${i + 1}] source: ${p.sourceName}${p.sourceRole ? ` (${p.sourceRole})` : ''} · ` +
        `${p.resourceTitle}${p.documentTitle ? ` · ${p.documentTitle}` : ''}\n${p.content}`,
    )
    .join('\n\n');
}
