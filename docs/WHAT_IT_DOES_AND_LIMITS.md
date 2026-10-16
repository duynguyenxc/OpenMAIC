# What the Platform Does, and What It Cannot Do Yet

**OpenMAIC teaching platform — Level 2**
Duy Nguyen · 2026-10-16

This document is written in plain language. It says what the system can do today, and it says
honestly what it cannot do. Nothing here is a promise about the future.

**Website:** https://openmaic-level2.vercel.app

---

## 1. The short version

Level 1 showed that OpenMAIC works. One person could open it and make a course, but everybody who
opened it was the same anonymous user. It could not be used with a real class.

**Level 2 turns it into a platform for a real class.** People now have their own accounts. A teacher
owns their own courses. A student sees only the courses they are in. One student cannot see another
student's work.

The learning part — the AI teacher, the AI classmates, the slides — is still OpenMAIC's. We did not
change it. We added who-is-who around it.

---

## 2. What the system can do

### Accounts and roles

There are three kinds of account.

| Role | What they can do |
|---|---|
| **Administrator** | Create and approve accounts, change roles, turn accounts on and off, see every course |
| **Instructor** | Make courses, add students, see what their students did, export the data, share a course with a colleague |
| **Student** | Open the courses they are enrolled in, and take the lesson |

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
- **See what each student did.** For each student: how many sessions, how many interactions, when
  they were last active, and their full conversation with the AI in time order.
- **Export the data.** CSV for Excel, or JSON. One row for each thing a student did.
- **Share with a colleague.** Another teacher can be added as an editor (can change the course) or a
  viewer (can only look).
- **Copy a course for another class.** The copy is separate: no students and no student work are
  copied. The original is not touched.

### For the student

- See only the courses they are in and that are published.
- Open the classroom and take the lesson, with the AI teacher and AI classmates.
- Their work is saved to their account, so they can come back to it from any computer.

### For the administrator

- See all accounts and all courses.
- Approve a new person and give them a role.
- Turn an account off. That person then cannot do anything.

### What is protected

These were tested by making the requests, not by trusting the design. All 41 checks pass on the
live website.

- A student cannot change a course.
- A student cannot see another student's answers.
- A student cannot send work pretending to be another student.
- A teacher cannot open another teacher's course, even with the exact web address.
- A person with no account cannot reach anything except the sign-in page.
- A student cannot make themselves an administrator.
- An administrator cannot lower their own role, so the platform can never be left with nobody in
  charge.

---

## 3. What the system cannot do yet

This section is as important as the one above.

### Things we could not prove

**Quiz and project records.** The plan says a teacher should be able to read quiz, chat and project
records. **Chat works and is proven.** Quiz and project records are **not proven** — the system has
never produced one, so there was nothing to read back. The code reads whatever kind of record
exists, so it should work, but "should work" is not the same as "was tested". The export has columns
for them and leaves those columns empty rather than inventing values.

### Things that are not built

- **No audit log.** We do not keep a record of who changed what. Level 3 asks for this.
- **No institutions.** Everyone is on one platform together. There is no idea of "this university"
  and "that university" yet. Level 3 adds it.
- **No research features.** No studies, no experiment groups, no rubrics, no AI marking, no
  automatic feedback. These are all Level 3.
- **No course templates to share between teachers.** A teacher can copy their own course, but there
  is no shared library. Level 3 adds it.
- **No handwriting or audio answers.** Students type. Level 3 adds the other kinds.
- **No connection to Canvas** or any other learning system.

### Things that need attention before real students use it

- **Database encryption check.** The connection to the database is encrypted, but the certificate
  chain is not fully checked. This is a known shortcut taken to make the connection work, and it
  should be fixed before real student data is stored. The exact fix is written down.
- **No limit on sign-in attempts.** Supabase, the sign-in service, has its own limits, but our
  platform adds none of its own.
- **No consent record.** There is no field saying whether a student agreed to their data being used
  for research. Level 3 asks for this, and it should exist before any research data is collected.
- **Course titles start as "Untitled course"** when a course is made by the AI generator. The
  teacher can rename it. This is untidy rather than harmful.
- **A student can still reach OpenMAIC's own workspace** at the site's bare address and ask the AI
  to build a lesson for themselves. Nothing of anyone else's is exposed — whatever they make is
  their own — but it spends credit on the shared AI key, so a class of students could run the key
  down. The instruction did not ask for this to be closed, and closing it would mean refusing a
  screen OpenMAIC ships. It should be decided before a real class uses the platform.

### Practical limits

- This runs on free hosting. It is fine for a small pilot class. It has **not** been tested with
  many students at the same time, and nobody should assume it will hold up for hundreds.
- Making a course costs money, because it calls an AI service. The cost is small per course, but it
  is not zero.
- The AI writes the lesson. It is usually good, but **a teacher should read a course before giving
  it to students.** The system does not check the lesson for mistakes.

---

## 4. What this proves about the approach

One fact is worth keeping, because it decides how much work the next level is.

OpenMAIC was built so that a host can plug in its own accounts. We used that: Level 2 registers one
piece of code that says who the user is, and OpenMAIC does the rest. Because OpenMAIC already keeps
each person's work separate by owner, changing *who* the owner is turned per-browser separation into
per-student separation on its own.

**We changed four of OpenMAIC's own files, and three of those are a few lines each.** Everything
else is new code in its own folders. This means we can still take new versions of OpenMAIC when
Tsinghua release them, instead of being stuck on an old copy forever.

---

## 5. Honest summary

**Ready to use:** a small pilot class, with a teacher who checks the course before giving it out,
and students whose data is not sensitive yet.

**Not ready for:** real research data, a large class, several universities, or anything needing an
audit trail or consent records.

**The next step** is Level 3, which adds institutions, studies, rubrics, AI marking and research
data export. It should not start until this level is approved.
