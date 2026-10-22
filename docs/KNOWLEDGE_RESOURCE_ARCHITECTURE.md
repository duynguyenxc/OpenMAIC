# Knowledge resources and retrieval (Level 3C)

**Duy Nguyen · 21 October 2026**

## The instruction's warning, which shaped everything

> *"Do not force all knowledge into a KG. Add KG support as one optional knowledge provider."*
> *"Create a clean abstraction: KnowledgeProvider."*
> *"Do not tightly couple OpenMAIC to one graph database."*

So nothing above `lib/level3/knowledge.ts` knows what a vector is, what a triple is, or what Neo4j
is. A caller asks a **source** for context and receives passages with provenance attached.

```
            assessment service        feedback service
                      \                   /
                       \                 /
                        gatherContext()            ← asks every attached source
                              |
                        KnowledgeProvider          ← the only contract
                     /         |          \
        DocumentRetriever  VectorRetriever  KnowledgeGraphRetriever
             (pg_trgm)       (pgvector)       (triples today;
                                               Neo4j / GraphRAG tomorrow)
```

Replacing a store means replacing one object in that bottom row. Nothing above it changes, which is
the whole point of the abstraction being asked for.

## Resource types, and what each means in practice

| Type | Retriever | What it does |
|---|---|---|
| `DOCUMENT_COLLECTION` | `DocumentRetriever` | trigram similarity over chunks — lexical overlap, honestly not understanding |
| `VECTOR_INDEX` | `VectorRetriever` | cosine distance over `vector(1536)` with an HNSW index; chunks are embedded on ingest |
| `KNOWLEDGE_GRAPH` | `KnowledgeGraphRetriever` | subject–predicate–object, matched at either end, returned as a sentence |
| `STRUCTURED_DATA` | `DocumentRetriever` | treated as documents until something needs otherwise |

`pgvector 0.8.2` and `pg_trgm` are enabled by the migration. The vector search is real, not a
simulation — but a chunk with **no** embedding is simply not found, and the interface reports a
resource as *"not by meaning — embedding failed"* rather than quietly degrading to keyword search
while claiming otherwise.

**The embedder is an argument, not an import.** `makeVectorRetriever(embed)` takes a function, so
the retriever never learns which vendor produced its numbers. `lib/level3/embeddings.ts` is the
default implementation and fails soft: no key or a provider error returns `null`, that source
returns nothing, and the others still answer.

## Several sources at once, named by the researcher

> *"Do not hard-code the labels K1 and K2 into the generic platform. Instead support
> knowledge_source_1 … knowledge_source_n. Each source should have: name; role; priority;
> retrieval policy; citation/provenance metadata."*

`knowledge_attachments` carries exactly that. The instructor writes `authoritative`,
`counterpoint`, `K1` — whatever their design calls for — and the platform **stores the label,
orders by priority, and never interprets it**. A passage arrives tagged with the source name it
came from, so a model's prompt shows which corpus said what, and so does the record afterwards.

Attachment scopes: `COURSE`, `TEMPLATE`, `AGENT`, `STUDY_CONDITION`. A course sees its own sources,
its template's and its agent configuration's, merged in priority order.

## Bounded agents

`agent_configurations` holds what the instruction lists: role, pedagogical function, response style,
prohibited behaviour, escalation rule, uncertainty behaviour, feedback policy — and
`permitted_resources`.

Versioned, like rubrics and templates, because a study cannot be reproduced against a configuration
that changed underneath it.

**`permitted_resources` is the bound, and it is enforced at retrieval.** `gatherContext` filters the
attached sources before asking any of them, so an agent restricted to the authoritative corpus
*consults* the authoritative corpus. It is not a line in a prompt asking a model to behave; the
model never sees the other material, and the provenance afterwards proves it. A test asserts exactly
this by reading `retrieval_events` and finding one source name where three were attached.

## Provenance

> *"If an agent response uses retrieved resources, make it possible to reconstruct which resources
> were provided to the model."*
> *"Do not claim citation precision unless it is actually available."*

Both sentences are honoured, and the second is the harder one.

`retrieval_events` records **one row per passage actually handed over**: the request id, the
purpose, the provider, the resource, the source name, the document, the **chunk or the edge**, the
retriever's score, the query, and the course, learner and response it was for. The assessment row
stores the `retrievalRequestId`, so "what was this model given" is one join.

What is deliberately **not** claimed: no row asserts that the model *used* what it was given.
`score` is the retriever's own number and nothing more — a cosine distance or a trigram similarity,
not a measure of relevance or of citation. Claiming more would be the precision the instruction
warns against.

## Degrading gracefully

> *"The student classroom must continue functioning even if ... KG service is unavailable."*

Nothing in the teaching path calls any of this. Within the research path, a failing source is
caught, logged and skipped: retrieval returns **fewer passages**, never an error. An empty resource
contributes nothing and breaks nothing, and both are covered by tests.

## What 3C does not do

- **No ingestion pipeline.** Text is posted and chunked by blank line. PDFs, crawling and OCR are
  not here; OpenMAIC's own document extractors are the obvious place to start when they are.
- **No re-embedding.** Changing the embedding model means re-ingesting a resource; nothing migrates
  vectors.
- **No reranking, no hybrid fusion.** Each source is retrieved independently and the passages are
  concatenated in priority order.
- **No remote graph.** `KnowledgeGraphRetriever` reads local triples. The `connection` column on a
  resource exists so a Neo4j or GraphRAG endpoint can be recorded, and the interface is where that
  implementation plugs in — but it is not written, and this document does not pretend it is.
