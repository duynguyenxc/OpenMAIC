# Research data model (Level 3A)

**Duy Nguyen · 21 October 2026**

## Entity relationships

Level-2 tables are unchanged apart from nullable columns added to `courses` and `user_profiles`.
No foreign key crosses into OpenMAIC's own tables; `runtime_sessions` and `runtime_records` are
joined by value, so OpenMAIC can migrate its storage without breaking this.

```mermaid
erDiagram
    INSTITUTIONS ||--o{ INSTITUTION_MEMBERSHIPS : has
    INSTITUTIONS ||--o{ USER_PROFILES          : "primary affiliation"
    INSTITUTIONS ||--o{ COURSES                : "section belongs to"
    USER_PROFILES ||--o{ COURSE_TEMPLATES      : publishes
    COURSE_TEMPLATES ||--o{ COURSES            : "cloned into"
    STUDIES ||--o{ STUDY_COURSES               : includes
    STUDIES ||--o{ STUDY_RESEARCHERS           : "authorizes"
    STUDIES ||--o{ RESEARCH_PARTICIPANTS       : registers
    COURSES ||--o{ STUDY_COURSES               : "is a section of"
    COURSES ||--o{ RESEARCH_EVENTS             : produced
    USER_PROFILES ||--o{ RESEARCH_PARTICIPANTS : "is, privately"
    USER_PROFILES ||--o{ RESEARCH_EVENTS       : "learner of"
    RUNTIME_RECORDS ||..o{ RESEARCH_EVENTS     : "projected from (no FK)"

    COURSE_TEMPLATES {
        uuid id PK
        text title
        text version "1.0, 1.1, 2.0"
        text source_stage_id "the OpenMAIC document"
        text visibility "PRIVATE INSTITUTION COMMUNITY ADMIN_ONLY"
        uuid created_by FK
    }
    STUDY_COURSES {
        uuid study_id PK_FK
        uuid course_id PK_FK
        text experimental_condition "free text, researcher-defined"
        text cohort_label
    }
    RESEARCH_PARTICIPANTS {
        uuid study_id PK_FK
        uuid user_id FK "never exported"
        text participant_id "P-00031, unique within the study"
        text consent_status "NOT_REQUESTED PENDING CONSENTED DECLINED WITHDRAWN"
    }
    RESEARCH_EVENTS {
        uuid id PK
        uuid study_id FK
        uuid course_id FK
        uuid learner_id FK
        text event_type
        text source_runtime_record_id "unique — makes projection idempotent"
        timestamptz event_timestamp
        jsonb structured_payload "summary only; the original is one join away"
    }
```

## De-identification

| | Where it lives | Appears in an export |
|---|---|---|
| email, display name | `user_profiles` | **never** |
| `research_participant_id` | `research_participants` | yes, as `participant_id` |
| the link between them | `research_participants.user_id` | **never** — administrator only |
| institutional student id | `user_profiles.external_identifier` | no |

A participant id is allocated **per study**, under an advisory lock so two learners entering at the
same moment cannot take the same number. The same person in two studies is two participants, and
neither dataset joins to the other without the linkage table.

## Event types

Mapped, because the application produces them:

| Runtime payload | Event type |
|---|---|
| `chat_message`, role `user` | `STUDENT_MESSAGE` |
| `chat_message`, role `assistant`/`system` | `AGENT_RESPONSE` |
| `chat_session_state` | `SCENE_OPEN` |
| `quiz*` | `QUIZ_RESPONSE` / `QUIZ_RESULT` — **mapped but never yet observed** |
| `pbl*` | `PBL_ACTION` — **mapped but never yet observed** |

Not mapped, because nothing produces them here: `SLIDE_VIEW`, `WHITEBOARD_ACTION`,
`FEEDBACK_REQUEST`, `FEEDBACK_SHOWN`, `FEEDBACK_ACCEPTED`, `FEEDBACK_REJECTED`,
`RESPONSE_REVISION`, `COURSE_OPEN`, `COURSE_EXIT`. Feedback and revision events belong to 3B and
will exist when that service does. The projection counts what it skipped and names the kinds, so
an unmapped kind is visible rather than silent.

## Reproducibility

`courses.configuration_snapshot` is written when a section is cloned and never updated. It holds
the template and version, the source document, the clone time, and OpenMAIC's stage configuration
at that moment. The instruction's question — *"WHAT EXACTLY DID THIS STUDENT EXPERIENCE?"* — cannot
be answered from current settings, because settings change; it is answered from this.

Raising a template version creates a new row rather than editing one, so a running study keeps
pointing at the design it started with.

## What is not yet captured

Honestly, so that nobody plans an analysis around it: **model name, model parameters and system
prompt version are not yet stored per generated response.** The snapshot records the course
configuration, not the per-call LLM metadata. That arrives with 3B, where the assessment service is
the first thing to make model-level provenance meaningful.
