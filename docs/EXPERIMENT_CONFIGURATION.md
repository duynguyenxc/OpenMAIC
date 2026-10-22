# Experiment configuration

**Duy Nguyen · 21 October 2026 · Level 3A**

The question this exists to answer is the instruction's own, in capitals:
**"WHAT EXACTLY DID THIS STUDENT EXPERIENCE?"** — and the reason it is hard is in the next line:
*"Do not rely only on the current configuration because settings may change later."*

## The three things that pin a condition down

### 1. The template version

A template is a published instructional design at a version: `1.0`, `1.1`, `2.0`. Publishing the
same title at the same version again is refused (`409 VERSION_EXISTS`). To change a design you
publish a new version, which leaves every running section pointing at the one it was cloned from.

`courses.template_id` and `courses.template_version` record which design and which version a
section came from, written once at clone time.

### 2. The configuration snapshot

`courses.configuration_snapshot` is written when the section is created and **never updated**:

```json
{
  "clonedFromTemplate": "d60f9e17-…",
  "templateTitle": "Demo module — Ethical decision making",
  "templateVersion": "1.0",
  "sourceStageId": "DMfo0x9xpq",
  "clonedAt": "2026-10-21T07:21:44.102Z",
  "openmaicStage": { "interactiveMode": …, "taskEngineMode": …, "sceneCount": 1 }
}
```

A section with no snapshot is reported as a data-quality failure, because a condition that cannot be
reconstructed cannot be analysed.

### 3. The condition label

`study_courses.experimental_condition` and `cohort_label`, set by an administrator per section.

**Labels are free text, deliberately.** The instruction lists `CONTROL`, `AI_FEEDBACK`,
`KG_BOUNDED_AGENT`, `PEER_AGENT`, `NO_PEER_AGENT` and immediately says *"Do not hard-code these
specific conditions. Allow researchers to define condition labels."* Nothing in the platform
validates the string, matches on it, or assumes a set.

A section in a study with no condition is reported as a data-quality failure for the same reason.

## A worked example, which exists in the live database

One module, three institutions, two conditions:

| Section | Institution | Condition | Cohort | Template |
|---|---|---|---|---|
| Course-US — Ethical decision making | US | `CONDITION-A` | `US-2026` | Demo module v1.0 |
| Course-UK — Ethical decision making | UK | `CONDITION-B` | `UK-2026` | Demo module v1.0 |
| Course-AU — Ethical decision making | AU | `CONDITION-A` | `AU-2026` | Demo module v1.0 |

The instructional content is equivalent — same template, same version, verified by comparing the
scene counts of all three. The course ids differ, the owners differ, the rolls differ, and no
learner record is shared. Rebuild it with `node scripts/level3-demo-study.mjs`.

## Changing a condition while a study runs

*"Once a study begins, do not silently modify an active course condition."*

The platform does not stop an administrator editing `study_courses`, and pretending otherwise would
be worse than saying so. What it does is make the change visible: the section keeps its original
snapshot and template version, so an analyst can see that the design did not change even if the
label did. **Publishing a new template version and cloning a new section is the supported way to
change a condition**, and the old section keeps its data.

## What is not captured yet, and must not be assumed

Named here so no analysis is planned around it:

- **Per-response model metadata** — model name, parameters, system prompt version for each
  generated answer. The section's configuration is captured; the per-call detail is not. It arrives
  with **3B**, where the assessment service makes model-level provenance meaningful.
- **Agent configuration versions** — agent roles, prohibited behaviour, feedback policy. **3C.**
- **Knowledge resources and retrieval provenance.** **3C.**
- **Random assignment.** *"Do NOT implement automatic random assignment until explicitly
  requested."* An administrator sets each section's condition by hand.
