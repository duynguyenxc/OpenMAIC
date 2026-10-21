-- ============================================================================
-- Level 3C — knowledge resources, retrieval, configurable agents, provenance.
--
-- The instruction's shape, and its warning, in one line each:
--
--   "Implement knowledge resources separately from the core LLM."
--   "Do not force all knowledge into a KG. Add KG support as one optional
--    knowledge provider."
--   "Do not tightly couple OpenMAIC to one graph database."
--
-- So nothing here names a vendor. A resource has a *type*, a provider is
-- chosen from that type, and the retriever behind it is an implementation
-- detail that can be replaced by Neo4j or a GraphRAG service without a schema
-- change.
-- ============================================================================

-- Real vector search rather than a simulation of one. Available in this
-- database at 0.8.2; enabling it costs nothing when nothing uses it.
CREATE EXTENSION IF NOT EXISTS vector;
-- Trigram indexes make the keyword retriever honest on small corpora instead
-- of a LIKE scan pretending to be search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Resources ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_resources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  description    text,
  -- The four the instruction names. A provider is selected from this; adding
  -- a fifth means adding a provider, not altering anything that exists.
  type           text NOT NULL
                   CHECK (type IN ('DOCUMENT_COLLECTION', 'VECTOR_INDEX',
                                   'KNOWLEDGE_GRAPH', 'STRUCTURED_DATA')),
  owner_id       uuid NOT NULL REFERENCES user_profiles (id) ON DELETE RESTRICT,
  institution_id uuid REFERENCES institutions (id) ON DELETE SET NULL,
  version        text NOT NULL DEFAULT '1.0',
  visibility     text NOT NULL DEFAULT 'PRIVATE'
                   CHECK (visibility IN ('PRIVATE', 'INSTITUTION', 'COMMUNITY', 'ADMIN_ONLY')),
  status         text NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  -- Vendor-neutral by design: a KNOWLEDGE_GRAPH resource can hold a Neo4j URI
  -- here and nothing above needs to know what a Neo4j URI is.
  connection     jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_resources_title_version
    ON knowledge_resources (owner_id, lower(title), version);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES knowledge_resources (id) ON DELETE CASCADE,
  external_id text,
  title       text NOT NULL,
  source_uri  text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_documents_resource ON knowledge_documents (resource_id);

-- Chunks are what retrieval actually returns, and what provenance points at.
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES knowledge_resources (id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES knowledge_documents (id) ON DELETE CASCADE,
  ordinal     integer NOT NULL DEFAULT 0,
  content     text NOT NULL,
  -- text-embedding-3-small. Nullable: a DOCUMENT_COLLECTION never embeds, and
  -- a VECTOR_INDEX can be ingested before it is embedded.
  embedding   vector(1536),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_resource ON knowledge_chunks (resource_id);
CREATE INDEX IF NOT EXISTS knowledge_chunks_trgm
    ON knowledge_chunks USING gin (content gin_trgm_ops);
-- Cosine distance, which is what the retriever orders by.
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding
    ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- A knowledge graph, deliberately as plain triples.
-- This is *an* implementation of the KnowledgeGraphRetriever, not *the* one:
-- the interface is what Level 3C promises, and a Neo4j or GraphRAG backing
-- store plugs in behind it without touching anything above.
CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES knowledge_resources (id) ON DELETE CASCADE,
  subject     text NOT NULL,
  predicate   text NOT NULL,
  object      text NOT NULL,
  evidence    text,
  document_id uuid REFERENCES knowledge_documents (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_graph_subject ON knowledge_graph_edges (resource_id, lower(subject));
CREATE INDEX IF NOT EXISTS knowledge_graph_object  ON knowledge_graph_edges (resource_id, lower(object));

-- ─── Attaching resources ────────────────────────────────────────────────────
-- "Allow resources to be attached to: template; course; agent; study
-- condition." And: "Do not hard-code the labels K1 and K2 into the generic
-- platform. Instead support knowledge_source_1 ... knowledge_source_n. Each
-- source should have: name; role; priority; retrieval policy; citation
-- metadata."

CREATE TABLE IF NOT EXISTS knowledge_attachments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id      uuid NOT NULL REFERENCES knowledge_resources (id) ON DELETE CASCADE,
  scope            text NOT NULL
                     CHECK (scope IN ('TEMPLATE', 'COURSE', 'AGENT', 'STUDY_CONDITION')),
  scope_id         text NOT NULL,
  -- The researcher's own label. "authoritative", "counterpoint", "K1" — the
  -- platform neither supplies nor interprets it.
  source_name      text NOT NULL,
  source_role      text,
  priority         integer NOT NULL DEFAULT 100,
  retrieval_policy jsonb,
  created_by       uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_id, source_name)
);

CREATE INDEX IF NOT EXISTS knowledge_attachments_scope ON knowledge_attachments (scope, scope_id);

-- ─── Configurable agents ────────────────────────────────────────────────────
-- "Do not hard-code these roles. Make them configurable templates." Versioned,
-- because success criterion 16 is "Agent roles/configurations are versioned"
-- and a study cannot be reproduced against a configuration that changed.

CREATE TABLE IF NOT EXISTS agent_configurations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  version               text NOT NULL DEFAULT '1.0',
  agent_role            text,
  pedagogical_function  text,
  response_style        text,
  prohibited_behavior   text,
  escalation_rule       text,
  uncertainty_behavior  text,
  feedback_policy       text,
  -- Which resources this agent may consult. An agent bounded to one source is
  -- an experimental condition, which is the point of the whole sublevel.
  permitted_resources   uuid[],
  created_by            uuid NOT NULL REFERENCES user_profiles (id) ON DELETE RESTRICT,
  status                text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_configurations_name_version
    ON agent_configurations (created_by, lower(name), version);

-- ─── Provenance ─────────────────────────────────────────────────────────────
-- "If an agent response uses retrieved resources, make it possible to
-- reconstruct which resources were provided to the model." One row per chunk
-- actually handed over, with the score that selected it.
--
-- And: "Do not claim citation precision unless it is actually available."
-- `score` is the retriever's own number and nothing more; no row here asserts
-- that the model used what it was given.

CREATE TABLE IF NOT EXISTS retrieval_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL,
  purpose       text NOT NULL,
  provider      text NOT NULL,
  resource_id   uuid REFERENCES knowledge_resources (id) ON DELETE SET NULL,
  source_name   text,
  document_id   uuid REFERENCES knowledge_documents (id) ON DELETE SET NULL,
  chunk_id      uuid REFERENCES knowledge_chunks (id) ON DELETE SET NULL,
  edge_id       uuid REFERENCES knowledge_graph_edges (id) ON DELETE SET NULL,
  score         numeric,
  query         text,
  course_id     uuid REFERENCES courses (id) ON DELETE SET NULL,
  learner_id    uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
  response_id   uuid REFERENCES learner_responses (id) ON DELETE SET NULL,
  retrieved_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retrieval_events_request ON retrieval_events (request_id);
CREATE INDEX IF NOT EXISTS retrieval_events_response ON retrieval_events (response_id);

-- Which agent configuration, if any, a course section runs under.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS agent_configuration_id uuid
    REFERENCES agent_configurations (id) ON DELETE SET NULL;

-- ─── Row-level security ─────────────────────────────────────────────────────
ALTER TABLE knowledge_resources     ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_graph_edges   ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_attachments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_configurations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_events        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON knowledge_resources, knowledge_documents, knowledge_chunks,
              knowledge_graph_edges, knowledge_attachments,
              agent_configurations, retrieval_events
  FROM anon, authenticated;
