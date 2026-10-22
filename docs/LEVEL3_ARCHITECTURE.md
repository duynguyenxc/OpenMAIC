# Level 3 — architecture

**Duy Nguyen · 22 October 2026 · 3A, 3B, 3C and 3D delivered — Level 3 complete**

Instruction v3 is explicit about pace: *"Do NOT attempt all Level-3 features simultaneously"*,
and *"After EACH sublevel: TEST, DOCUMENT, DEPLOY TO STAGING, REPORT."* This document describes
**3A**, says plainly what it does not contain, and stops.

## The shape

```
                    OpenMAIC            unchanged multi-agent classroom
                        +
            Secure multi-user platform  Level 2 — identity, roles, courses
                        +
            Research instrumentation    Level 3A — institutions, studies, events
                        +
      Assessment / feedback services    Level 3B — rubrics, assessment, feedback
                        +
              Knowledge services        Level 3C — resources, retrieval, bounded agents
                        +
   Modalities, jobs, integration       Level 3D — handwriting, audio, LMS boundary, analytics
```

Each layer sits **on** the one below and may be removed without it. That is not an aesthetic
preference: *"The student classroom must continue functioning even if the analytics service
fails."* Nothing in the teaching path calls anything added in 3A.

## What 3A added

| Concern | Where it lives |
|---|---|
| Institutions, and who belongs to them | `institutions`, `institution_memberships`, `user_profiles.primary_institution_id` |
| One design, many sections | `course_templates`; `courses.template_id`, `template_version`, `configuration_snapshot` |
| Studies and experimental conditions | `studies`, `study_courses`, `study_researchers` |
| Research identity, separate from identity | `research_participants` |
| What learners actually did | `research_events`, projected from OpenMAIC's `runtime_records` |
| Who did what, administratively | `audit_log` |
| Code | `lib/level3/*`, `app/api/level3/*`, `app/platform/researcher`, `components/level3/*` |

## What 3B added

| Concern | Where it lives |
|---|---|
| Rubrics, versioned and immutable once published | `rubrics`, `rubric_dimensions`, `rubric_levels` |
| A rubric and a feedback policy per activity | `rubric_assignments` |
| Answers and their revisions | `learner_responses` (`attempt_number`, `parent_attempt_id`) |
| AI and human judgements, kept apart | `assessments` (`assessor_kind`), `assessment_scores` |
| What a human decided about an AI score | `assessment_reviews` |
| Every piece of feedback generated | `feedback_events` |
| Services | `lib/level3/assessment.ts`, `lib/level3/feedback.ts` |

## What 3C added

| Concern | Where it lives |
|---|---|
| Knowledge resources of four types | `knowledge_resources`, `knowledge_documents`, `knowledge_chunks`, `knowledge_graph_edges` |
| The abstraction everything retrieves through | `lib/level3/knowledge.ts` — `KnowledgeProvider` |
| Three retrievers behind it | `DocumentRetriever` (pg_trgm), `VectorRetriever` (pgvector), `KnowledgeGraphRetriever` (triples) |
| Several sources at once, named by the researcher | `knowledge_attachments` |
| Configurable, versioned, **bounded** agents | `agent_configurations`, `courses.agent_configuration_id` |
| What the model was actually given | `retrieval_events` |

`docs/KNOWLEDGE_RESOURCE_ARCHITECTURE.md` has the detail, including what is deliberately not
claimed about citation precision. 3C touches **no** upstream file.

## What 3D added

| Concern | Where it lives |
|---|---|
| Handwriting and audio as services | `lib/level3/media.ts` — `ResponseProcessor` |
| The student's original, kept | `response_media` |
| Work that must not block a student | `lib/level3/jobs.ts`, `processing_jobs` |
| What the models cost, and where | `lib/level3/usage.ts`, `model_usage` |
| A boundary for LMS, not an LMS | `lib/level3/lms.ts`, `lms_integrations`, `lms_course_links`, `lms_grade_postings` |
| Conditions, agreement, revision effect | `lib/level3/analytics.ts` |

`docs/MULTIMODAL_AND_INTEGRATION.md` has the detail. The one upstream file 3D touches is
`lib/server/model-routes.ts`, one more string for the vision stage.

`docs/RUBRIC_SYSTEM.md` has the detail. The one upstream file 3B touches is
`lib/server/model-routes.ts`, two strings, recorded in `UPSTREAM_DELTA.md`.

**No upstream OpenMAIC file was touched by 3A.** The delta in `docs/UPSTREAM_DELTA.md` is
unchanged from Level 2 — still seven files — and the whole research layer is additive.

## Three decisions worth defending

### Research events are a projection, not a second write path

`research_events` is derived from `runtime_records`, which OpenMAIC already writes. Nothing in the
classroom writes research data, so research instrumentation cannot slow teaching down or break it,
and a failed projection loses nothing: the originals are untouched and it can be run again.

Every row carries `source_runtime_record_id`, and a unique index on that column makes the
projection **idempotent** — running it twice cannot double-count, which a dataset would not
survive. It is also why *"Do not generate fake events"* is a property of the design rather than a
promise: an event that no record produced cannot exist.

Today the classifier maps the four kinds this deployment actually produces (`chat_message` by role,
`chat_session_state`). The instruction lists fifteen. The rest are **not** mapped, and the
projection reports what it skipped, so an unmapped kind shows up as a number instead of
disappearing. When a quiz record first exists, `classify` gains a branch and the projection is
re-run over the same records.

### Institutions group; they never grant

*"Do not infer permissions solely from institution membership. Course-level authorization remains
authoritative."* Belonging to Institution-UK does not open a UK course. Every course check is still
Level 2's — ownership, co-instructor grant, active enrolment — and `lib/level3/authorization.ts`
only ever asks a **narrower** question about a study.

A RESEARCHER has no course permission anywhere in the platform, by construction rather than by
convention: `coreRoles()` gives the role an empty set, so it carries nothing OpenMAIC would honour.

### Identity and research identity are different things

`research_participants` is the only place a person and `P-00031` appear together. The export query
selects no email and no display name; the researcher's participant listing returns ids alone and
says `identified: false`. Consent is separate from enrolment, so a student can use the platform for
their course and be in nobody's dataset — the export filters on consent, and reports how many it
excluded.

## What 3A does not contain

Named here so nobody has to discover it by looking:

- **Random assignment to conditions.** *"Do NOT implement automatic random assignment until
  explicitly requested."* Conditions are set by an administrator per section.
- **Retention is configurable but never automatic.** `retention_policy` records the periods and
  strategy an administrator sets and reports what they would cover; nothing deletes on a timer,
  because *"Do not permanently delete records automatically without explicit policy."*
- **A real LMS adapter.** 3D builds the boundary and one manual provider; no Canvas, no LTI launch,
  no roster synchronisation over a network. The platform is designed to work without one.
- **Retention policy.** The consent states exist; automatic deletion does not, deliberately —
  *"Do not permanently delete records automatically without explicit policy."*

## Documents

| Document | Covers |
|---|---|
| `LEVEL3_BASELINE.md` | what Level 3 was built on, recorded before any Level-3 code |
| `LEVEL3_ARCHITECTURE.md` | this file |
| `DATABASE_SCHEMA.md` | all three groups of tables, and why no foreign key crosses between them |
| `RESEARCH_DATA_MODEL.md` | the research tables, event types, de-identification |
| `AUTHORIZATION_MODEL.md` | every check, for both levels |
| `EXPERIMENT_CONFIGURATION.md` | what pins a condition down, and what is not captured yet |
| `DATA_DICTIONARY.md` | every export column, and the data-quality checks |
| `API.md` | every route and the check it performs |
| `DEPLOYMENT.md` | what is deployed where, environment, migrations, restoring Level 2 |
| `UPSTREAM_DELTA.md` | the seven upstream files, unchanged by Level 3A |
| `ADMIN_MANUAL.md`, `INSTRUCTOR_MANUAL.md`, `STUDENT_MANUAL.md`, `RESEARCHER_MANUAL.md` | per role |

| `RUBRIC_SYSTEM.md` | rubrics, assessment, review, feedback, revisions |
| `KNOWLEDGE_RESOURCE_ARCHITECTURE.md` | resources, the provider interface, bounded agents, provenance |
| `MULTIMODAL_AND_INTEGRATION.md` | handwriting, audio, the job queue, the LMS boundary, usage, analytics |
| `SECURITY_TEST_REPORT.md` | every attack tested, with the results and what is not claimed |
| `PERFORMANCE_AND_PRODUCTION.md` | the measured limit of this hosting, and a production architecture |
| `examples/example-research-export.{json,csv}` | a real de-identified export of the worked study |

Every document instruction v3 names now exists.

## Tests

| Suite | Checks | Covers |
|---|---|---|
| `scripts/level2-security-tests.mjs` | **58** | everything Level 2 guarantees, re-run as a regression gate |
| `scripts/level3-research-tests.mjs` | **46** | the end-to-end scenario v3 specifies, with real requests |
| `scripts/level3b-assessment-tests.mjs` | **42** | rubrics, assessment, review, feedback, revisions — with **real model calls**. `SKIP_LLM=1` runs the 28 that do not need one |
| `scripts/level3c-knowledge-tests.mjs` | **35** | three retrievers, several sources at once, bounded agents, provenance — with **real embeddings**. `SKIP_LLM=1` runs the 23 that do not need one |
| `scripts/level3d-media-tests.mjs` | **42** | uploads, the queue, the LMS boundary, usage, analytics — with a **real vision call**. `SKIP_LLM=1` runs the 37 that do not need one |
| `tests/level3/permissions.test.ts` | **23** | unit tests: feedback policy, consent, parsing, provider selection, cost, the LMS boundary — no server, no database |
| `scripts/level3-load-check.mjs` | — | concurrency measurement; see `PERFORMANCE_AND_PRODUCTION.md` |

**223 API checks and 23 unit tests**, all passing.

Both suites now name their fixtures after the run and remove them afterwards, because a suite that
leaves courses behind fills a platform with sections nobody can tell apart.
