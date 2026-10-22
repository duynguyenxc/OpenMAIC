# Data dictionary — research export (Level 3A)

**Duy Nguyen · 21 October 2026**

One row per recorded learner event, in CSV or JSON, from
`GET /api/level3/studies/<id>/export?format=csv|json`.

Only **consented** participants are included unless `includeAllConsentStates=true` is passed, which
is recorded in the audit log as having happened.

| Column | Type | Meaning |
|---|---|---|
| `study_id` | uuid | the study this row belongs to |
| `study_title` | text | its title, for a reader |
| `course_id` | text | the OpenMAIC stage id of the section — **the unit of isolation** |
| `course_title` | text | the section's name |
| `institution` | text / null | short name of the institution the section belongs to |
| `experimental_condition` | text / null | as set by an administrator; researcher-defined, not from a fixed list |
| `cohort_label` | text / null | free label, e.g. `US-2026` |
| `participant_id` | text | `P-00031`. **The only identifier of a person in this file** |
| `consent_status` | text | always `CONSENTED` unless the export was explicitly widened |
| `session_id` | text / null | OpenMAIC runtime session |
| `activity_id` | text / null | scene id within the course |
| `event_type` | text | `STUDENT_MESSAGE`, `AGENT_RESPONSE`, `SCENE_OPEN`, … |
| `event_timestamp` | ISO-8601 UTC | when it happened |
| `sequence_number` | integer / null | order within the session; preserves sequence |
| `payload_kind` | text / null | the OpenMAIC payload kind the event came from |
| `payload_role` | text / null | `user`, `assistant`, `system` |
| `characters` | integer / null | length of the message, for a quick measure without the text |
| `excerpt` | text / null | first 280 characters; the full content is in the runtime record |
| `template_title` | text / null | the shared module this section was cloned from |
| `template_version` | text / null | its version at clone time |
| `source_runtime_record_id` | text / null | the OpenMAIC record this row was derived from |

**Never present:** email, display name, institutional student number, account id.

## The data-quality report

Returned beside the rows in JSON, and shown on the researcher's page. Each check is a count of
failures, computed over the study rather than over the export, so it can report what the export is
**missing** as well as what it contains.

| Check | Why it matters |
|---|---|
| events with no research participant record | a learner worked in a study section but was never registered, so their events are invisible to the dataset |
| events dated in the future | an impossible timestamp means a clock or an import problem |
| events not traceable to a runtime record | every event should name the OpenMAIC record it came from |
| study courses with no experimental condition | a section without a condition cannot be analysed as one |
| study courses with no configuration snapshot | what the student experienced cannot be reconstructed later |

`excluded.participantsWithoutConsent` says how many people this export deliberately leaves out.
