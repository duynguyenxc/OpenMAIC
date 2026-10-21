# Instructor Manual

**OpenMAIC teaching platform — Level 2**

---

![My courses, as an instructor sees it](screenshots/03-instructor-my-courses.jpg)

*The instructor dashboard. One row per course with its id, how many students are on it and when it
was last used; search, a status filter and a sort above; and on each row Students, Results, Open,
Edit, Rename, Publish, Duplicate and Delete. "+ New course" opens the OpenMAIC workspace, where a
course you make becomes yours automatically.*

![The students on one course](screenshots/04-instructor-students.jpg)

*Clicking Students opens everything about that course over the page. Add a student by email;
Remove turns their access off without destroying their work, and Restore turns it back on.*

![The teaching team](screenshots/05-instructor-teaching-team.jpg)

*The second tab shares a course with a colleague. An editor can change the course and see its
students; a viewer can only read. Only the owner can enrol students, publish or delete, and the
owner cannot be removed or demoted here — handing a course over is a separate, deliberate act.*

## Signing in

Go to `/platform` and sign in with your email and password. You land on your instructor dashboard.
There is no shared access code; your account is the credential.

---

## Creating a course

Courses are created in the OpenMAIC workspace, as before: open the workspace from **Open workspace**
on your dashboard (or go to `/`), describe what you want taught, and let OpenMAIC generate it.

The course becomes **yours** automatically — you are recorded as its OWNER in the same transaction
that creates it. Nobody else can see it until you publish it and enrol students.

A new course starts as a **draft**. Students cannot open a draft even if they are enrolled, which
gives you room to prepare it.

---

## Your course list

Each course shows its title, status, number of students, co-instructors and last activity, with
five actions:

| | |
|---|---|
| **Edit** | open the course in the OpenMAIC editor |
| **Open classroom** | enter the classroom yourself, as a learner would see it |
| **Manage students** | the enrolment roll |
| **Results** | what your students have done |
| **Duplicate** | make a copy for another section |
| **Publish / Unpublish** | make the course available to enrolled students, or withdraw it |

---

## Enrolling students

**Manage students** opens the roll. Type a student's email and press **Add student**.

Two rules the platform enforces:

- The person must already have an account. Enrolment does not create accounts; ask an administrator
  to create one.
- The account must be a **STUDENT**. An instructor or administrator account cannot be enrolled as a
  learner.

**Deactivate** removes a student's access immediately — on their very next request, not when some
cache expires. The enrolment row is kept rather than deleted, so their existing work stays
attributable; **Reactivate** restores access.

### A student can open your course only when all of this is true

They are signed in, they have an **ACTIVE** enrolment, and the course is **PUBLISHED**. Leave any
one out and they are refused. If a student reports they cannot get in, check the course is
published before anything else — that is the usual cause.

---

## Seeing what students have done

**Results** lists every enrolled student with their session count, number of interactions, the kinds
of activity recorded, and when they were last active.

**View trajectory** on a row opens that student's chronological record: each event with its
timestamp, what the student wrote, and what the AI replied.

You see this only for courses you are authorised on. A request for another instructor's course is
refused outright — you are not shown a filtered empty list that might be mistaken for "no activity".

---

## Exporting

**Export CSV** and **Export JSON** on the Results panel download everything recorded for that
course.

The columns are: course id and title, student identifier and internal id, student email, activity
id and type, session kind, sequence, timestamp, learner input, agent response, and the untouched
payload. Quiz and PBL columns are present but **empty** — this deployment has not yet produced
records of those kinds, and the platform does not invent values it does not have.

Exports never contain passwords, API keys or credentials.

---

## Sharing a course with a colleague

Add a co-instructor through the course's instructors endpoint as **EDITOR** (may edit the course and
inspect students) or **VIEWER** (may look, not change). Only you, the OWNER, can add or remove
co-instructors, publish, or delete.

Removing a co-instructor takes effect immediately: the course disappears from their list and their
API access fails on the next request.

---

## Duplicating a course for another section

**Duplicate** makes an independent copy:

- the original is untouched;
- the copy gets a new id and starts as a **draft**;
- **no student data is copied** — no enrolments and no learner interaction;
- you are the OWNER of the copy.

This is how to run the same material with a second group without the two sharing results.

---

# Level 3 — sharing a module, and running somebody else's

At the bottom of **My courses** there is a **Shared modules** panel. It does two different things.

## Publishing one of your courses as a module

Press **Publish one of my courses**, choose the course, give it a **version** and a **visibility**:

| Visibility | Who can see and clone it |
|---|---|
| `PRIVATE` | only you |
| `INSTITUTION` | anyone at your institution |
| `COMMUNITY` | every instructor on the platform |
| `ADMIN_ONLY` | administrators only |

Publishing shares **the instructional design**, never your class. Nobody gains access to your
course, your students or their work by seeing your module.

### Versions, and why they matter

Publishing the same title at the same version twice is refused. To change a design, publish a new
version — `1.1`, `2.0`. Sections already cloned keep pointing at the version they were made from,
which is what lets a study that is running stay comparable.

## Running a module somebody else published

Press **Use this module**. You get a course of your own:

- a **new course id**;
- **you** as its owner;
- **no students** — the roll starts empty;
- **no learner data of any kind** from the original or from anyone else's section;
- a record of which module and version it came from, and a snapshot of the configuration at that
  moment, so a researcher can reconstruct later what your students experienced.

It arrives as a draft. Add your students and publish it exactly as you would any course.

Three instructors at three institutions can run the same module at the same time, and each sees
only their own students. That is the entire point of this level, and it is tested rather than
asserted.

## If your course is part of a study

An administrator can add your section to a research study and give it an experimental condition.
That changes nothing about your teaching, your roll or your access.

It does mean a researcher authorized for that study can read **de-identified** data from your
section: participant identifiers, not names. You keep the identified view of your own students;
they never get it.

Being an instructor on a study's section does **not** give you access to the study, and you cannot
export it — that is deliberate, and tested.

---

# Level 3B — rubrics, AI assessment, and feedback

The **Rubrics and assessment** panel is at the bottom of *My courses*.

## Making a rubric

A rubric is a list of dimensions, each with a maximum score and, if you want, a description of what
each score means. It has a **version**.

Versions are not decoration. Once a rubric is published you cannot edit it — publishing the same
title at the same version again is refused. To change it, publish `1.1`. That is what keeps a
study's numbers comparable: nothing can be re-scored under a rubric that quietly changed.

## Attaching it to an activity

Choose a course, an activity, a rubric and a **feedback policy**:

| Policy | When the student gets feedback |
|---|---|
| `OFF` | never |
| `ON` | whenever it is asked for |
| `AFTER_FIRST_RESPONSE` | only from their second attempt — the first answer stays a clean measurement |
| `AFTER_SUBMISSION` | only once they have submitted |
| `ON_REQUEST` | only when they ask |

The same module can run in two courses with the same rubric and different policies. That is how a
study compares conditions, and it needs no special setup.

## Assessing an answer

Every attempt appears in the list, not only the last one, with who wrote it and whether it is a
revision.

**Assess with AI** scores it against the rubric. You get a score per dimension, a **quotation from
the student's own words** as evidence, and a confidence. The model used and the rubric version are
stored with the result, so a score from today is still interpretable next year.

## Reviewing — and why your score never disappears

Press **Review** and you see the AI's scores and yours side by side.

- **Accept** — you agree. The AI's score becomes the final one.
- **Revise** — you give your own scores. They are stored **beside** the AI's, which is unchanged.
- **Reject** — you discard the AI's judgement. It is still kept.

In all three cases nothing is overwritten. That is deliberate: a record where your score replaced
the AI's could never answer how often the two agreed, which is one of the things this platform
exists to find out.

Until a human has looked at it, **an AI score is not a final score**, and the panel says so.

## Feedback

**Generate feedback** produces one short piece aimed at the weakest part of that particular answer.
It is given the student's earlier attempts and the feedback they have already had, and told not to
repeat itself.

Every piece generated is recorded, whether the student saw it or not. A student asking for feedback
themselves is recorded as shown; one you generate to look at is recorded as generated. A researcher
can tell the difference, which matters when measuring whether feedback changed anything.

---

# Level 3C — knowledge sources and bounded agents

The **Knowledge sources and agents** panel sits below assessment.

## Making a source of knowledge

Four kinds, and the kind decides how it is searched:

| Kind | Searched how |
|---|---|
| `DOCUMENT_COLLECTION` | by keyword |
| `VECTOR_INDEX` | **by meaning** — the text is embedded when you add it |
| `KNOWLEDGE_GRAPH` | facts written as `subject \| predicate \| object`, matched at either end |
| `STRUCTURED_DATA` | by keyword |

Add content by pasting it. Blank lines separate chunks. For a vector index the panel tells you how
many chunks were embedded — if that number is zero it says so, and the source is searched by
keyword only. It will not pretend to understand text it never embedded.

## Giving a course its sources

Choose a course, a resource, and **a name of your own**: `authoritative`, `counterpoint`, `K1`,
anything. The platform stores your label, uses it to order and to tag every passage, and never
interprets it. A course can use several sources at once, and a lower priority number goes first.

When an answer is assessed or feedback is generated, every attached source is asked for context,
and every passage that came back is recorded — which source, which document, which chunk, what
score.

## Bounded agents

An agent configuration says how an agent should behave: its role, its style, what it must not do,
what to do when unsure — and **which resources it may consult**.

That last one is not a request. An agent bounded to one resource consults one resource: the others
are never asked, the model never sees them, and the record afterwards shows a single source. That
is what makes "the same module under a bounded agent" a real experimental condition rather than a
hopeful instruction in a prompt.

Press **Use for the chosen course** to run a section under a configuration. Configurations are
versioned: publish `1.1` rather than editing `1.0`, so a study that is running keeps the behaviour
it started with.
