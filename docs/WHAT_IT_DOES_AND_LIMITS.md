# What the Platform Does, and What It Cannot Do Yet

**OpenMAIC teaching and research platform — Levels 2 and 3**
Duy Nguyen · first written 2026-10-16 for Level 2 · rewritten 2026-10-29 for Level 3

This document is written in plain language. It says what the system can do today, and it says
honestly what it cannot do. Nothing here is a promise about the future.

**Website:** https://openmaic-level2.vercel.app

> **A note on the previous version.** Until today this document described Level 2 alone and told
> the reader there were no institutions, no studies, no rubrics and no research features. All four
> now exist. If you read this document before 29 October 2026, read it again — the "cannot do" list
> was the part that changed most.

---

## 1. The short version

Level 1 showed that OpenMAIC works. One person could open it and make a course, but everybody who
opened it was the same anonymous user. It could not be used with a real class.

**Level 2 turned it into a platform for a real class.** People have their own accounts. A teacher
owns their own courses. A student sees only the courses they are in. One student cannot see
another student's work.

**Level 3 turned it into a platform you can run a study on.** Universities are separate from one
another. A researcher can define a study, attach courses to it as experimental conditions, mark a
rubric, let the AI grade against it, have a human check the AI, and export only the data of
students who consented — with the disagreements between AI and human named rather than hidden.

The learning part — the AI teacher, the AI classmates, the slides — is still OpenMAIC's. We did not
change it. We added who-is-who around it, and then a research layer beside it.

---

## 2. What the system can do

### Accounts and roles

There are four kinds of account.

| Role | What they can do |
|---|---|
| **Administrator** | Create and approve accounts, change roles, turn accounts on and off, put people in an institution, see every course |
| **Instructor** | Make courses, add students, see what their students did, export the data, share a course with a colleague |
| **Student** | Open the courses they are enrolled in, and take the lesson |
| **Researcher** | Open only the studies they were added to. A researcher is **not** a teacher and can change no course |

A person signs in with their own email and password. The system then decides what they can see. A
student who guesses an address still cannot get in, because the decision is made on the server and
not in the page.

### For the teacher

- **Make a course.** Describe a topic and OpenMAIC writes the lesson: slides, an AI teacher, and AI
  classmates. The course belongs to you from the moment it is made.
- **Draft and published.** A new course is a draft. Students cannot open a draft even if they are
  enrolled. You publish it when it is ready.
- **Add and remove students.** You add a student by email. Removing a student stops their access
  straight away, on their next click — not after some delay.
- **See what each student did.** For each student: how many sessions, how many answers, when they
  were last active, and their full conversation with the AI in time order.
- **See the course as a whole.** How many are enrolled, how many have actually opened it, how much
  work there is. Where a number cannot honestly be produced, the screen says so instead of showing
  a zero that reads like a measurement.
- **Export the data.** CSV or JSON, narrowed by student, activity, date range and data type — or
  the whole course in one link.
- **Share with a colleague.** Another teacher can be added as an editor (can change the course) or
  a viewer (can only look). Shared courses say who they are shared with.
- **Copy a course for another class.** The copy is separate: no students and no student work are
  copied. The original is not touched.
- **Use the research tools, when wanted.** Rubrics, shared templates and knowledge resources sit on
  the teacher's page folded away, each with one line saying what it is for. A teacher who came only
  to look at their classes never has to meet them.

### For the student

- See only the courses they are in and that are published.
- Open the classroom and take the lesson, with the AI teacher and AI classmates.
- See their own activity in a course.
- Their work is saved to their account, so they can come back to it from any computer.

### For the administrator

- See all accounts and all courses.
- Approve a new person and give them a role.
- Put a person in an institution. This matters: sharing scoped to an institution reaches only
  people who are actually in one.
- Turn an account off. That person then cannot do anything.
- Read the **audit log** — who changed what, administratively.
- Set a **data retention policy**, and see what it would cover. It deletes nothing. A research
  dataset destroyed overnight by a timer nobody remembered setting is exactly the failure this
  guards against.

### For the researcher

- **Institutions.** Universities are separate. Belonging to one groups people; it never opens a
  course by itself.
- **Studies.** A study has researchers, courses attached as experimental conditions, and
  participants. A researcher sees only the studies they were added to.
- **Research identity is separate from identity.** A participant in a study is not the same record
  as the person's account, and the export can be de-identified.
- **Consent decides the export, not enrolment.** A student whose consent is missing, pending,
  declined or withdrawn is **not** in the exported data, and the export says how many were left out.
- **Templates.** One course design used for many sections, with the version recorded against each.
- **Rubrics.** Versioned, and **frozen once published** — a study cannot have the ruler change
  underneath it.
- **AI marking and human marking, kept apart.** Both are stored. A human can review an AI score.
  The screen **marks the rows where the two disagree**, which is the number a study is built on.
- **Knowledge resources.** Documents, vectors and a knowledge graph, behind one interface, so an AI
  agent can be given a bounded body of material instead of the whole internet. What the model was
  actually handed is recorded.
- **Handwriting and audio answers**, with the student's original kept.
- **Analytics** by condition, agreement between markers, and the effect of letting a student revise.
- **Cost.** What the AI models were used for and what that cost is recorded per study.

### What is protected

These were tested by making the requests, not by trusting the design. **261 checks pass against the
live website**, across five suites.

- A student cannot change a course.
- A student cannot see another student's answers.
- A student cannot send work pretending to be another student.
- A teacher cannot open another teacher's course, even with the exact web address.
- A student cannot see research data — **even if an administrator names that student as the
  principal investigator of a study.** The platform role wins over the row.
- Belonging to the same institution as somebody does not open their course.
- Holding the researcher role does not open a study you were not added to.
- Someone who can read a study's data cannot necessarily export it.
- A person with no account cannot reach anything except the sign-in page.
- A student cannot make themselves an administrator.
- An administrator cannot lower their own role, so the platform can never be left with nobody in
  charge.

---

## 3. What the system cannot do yet

This section is as important as the one above.

### Things we could not prove

**Quiz and project records.** The plan says a teacher should be able to read quiz, chat and project
records. **Chat works and is proven.** Quiz and project records are **not proven** — this
deployment has never produced one, so there was nothing to read back. The code reads whatever kind
of record exists, so it should work, but "should work" is not the same as "was tested". The export
and the course overview leave those columns empty, and say they are empty, rather than inventing
values.

This is the single largest gap between what is built and what is demonstrated, and it will close by
itself the first time a class runs a quiz.

### Things that are a boundary, not a feature

- **No connection to Canvas or any other learning system.** There is a defined place to plug one
  in, and nothing plugged into it.
- **Nothing runs on a schedule.** Transcription and data projection happen when something calls
  them, not by themselves. For a pilot this is invisible; for a live study it would need a worker.
- **Nothing stops AI spending.** The cost of every model call is recorded. No ceiling refuses one.

### Things that need attention before real students use it

- **Database encryption check.** The connection to the database is encrypted, but the certificate
  chain is not fully verified. This is a known shortcut taken to make the connection work, recorded
  since Level 2, and it should be fixed before real student data is stored. The exact fix is
  written down in `docs/LEVEL2_SECURITY_MODEL.md`.
- **No limit on sign-in attempts.** Supabase, the sign-in service, has its own limits, but our
  platform adds none of its own.
- **Level 2 and Level 3 share one database.** They should be separated. Sharing one is how a role
  added for Level 3 once briefly broke the Level-2 build.
- **Uploaded audio and images are stored in the database itself.** Fine for a pilot; a cohort's
  recordings do not belong in table rows.
- **A student can still reach OpenMAIC's own workspace** at the site's bare address and ask the AI
  to build a lesson for themselves. Nothing of anyone else's is exposed — whatever they make is
  their own — but it spends credit on the shared AI key, so a class of students could run the key
  down. The instruction did not ask for this to be closed, and closing it would mean refusing a
  screen OpenMAIC ships. It should be decided before a real class uses the platform.

### Practical limits

- This runs on free hosting. **60 people acting at the same moment has been measured and works.**
  Beyond that nothing has been measured, and nobody should assume it holds for hundreds.
- Making a course costs money, because it calls an AI service. The cost is small per course, but it
  is not zero.
- The AI writes the lesson. It is usually good, but **a teacher should read a course before giving
  it to students.** The system does not check the lesson for mistakes.
- **The AI marks to a rubric. It is not a marker you should trust unchecked.** That is why human
  review exists, why both scores are kept, and why the disagreements are shown. Treat the AI score
  as a first pass.

---

## 4. What this proves about the approach

Two facts are worth keeping, because together they decide how much work anything after this is.

**OpenMAIC was built so that a host can plug in its own accounts.** We used that: Level 2 registers
one piece of code that says who the user is, and OpenMAIC does the rest. Because OpenMAIC already
keeps each person's work separate by owner, changing *who* the owner is turned per-browser
separation into per-student separation on its own.

**The research layer writes beside the classroom, never into it.** Research data is a *projection*
of the records OpenMAIC already keeps — not a second thing the classroom has to remember to write.
A study can be added to a course that has already run, and an instrumentation fault can never
damage a lesson.

Between them, this is why the whole of Level 3 touched almost nothing of OpenMAIC's own code. The
full list is in `docs/UPSTREAM_DELTA.md`, and most entries are a handful of lines. We can still
take new versions of OpenMAIC when Tsinghua release them, instead of being stuck on an old copy
forever.

---

## 5. Honest summary

**Ready to use:** a pilot class, with a teacher who checks the course before giving it out. Ready
for a small study, with consent collected, the AI's marking checked by a human, and somebody
watching the model spending.

**Not ready for:** hundreds of simultaneous students, an unattended live study that needs work to
happen on a schedule, storing sensitive data before the database certificate chain is verified, or
anything that must post grades back to Canvas.

**What would most change the picture** is running one real class with a quiz in it. That single run
would close the largest unproven gap in this document, and it costs nothing but a class.
