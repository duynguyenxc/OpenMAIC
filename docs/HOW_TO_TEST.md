# How to Test the Platform

**OpenMAIC teaching platform — Level 2**
Duy Nguyen · 2026-10-16

This guide shows you how to test the system yourself. You do not need to install anything. You only
need a web browser.

**Website:** https://openmaic-level2.vercel.app

There is no shared code to type. You sign in with an account, like any normal website.

---

## Before you start

You need the test accounts and their passwords. There are six:

| Role | Email |
|---|---|
| Administrator | `admin@example.test` |
| Instructor | `instructor1@example.test` |
| Instructor | `instructor2@example.test` |
| Student | `student1@example.test` |
| Student | `student2@example.test` |
| Student | `student3@example.test` |

The passwords are kept in a file that is **not** in the code repository. Ask Duy for them.

**How the test data is set up:**

- Instructor 1 owns one course. Students 1 and 2 are in it.
- Instructor 2 owns a different course. Student 3 is in it.

This lets you check that people only see their own courses.

---

## Test 1 — Sign in works (2 minutes)

1. Open https://openmaic-level2.vercel.app
2. You will be sent to a sign-in page.
3. Sign in as `admin@example.test`.

**What should happen:** you land on the Administrator page. You did not have to choose a page — the
system looked at your account and sent you to the right one.

4. Click **Sign out**, then sign in as `instructor1@example.test`.

**What should happen:** this time you land on the Instructor page.

5. Sign out, then sign in as `student1@example.test`.

**What should happen:** you land on the Student page.

**Why this matters:** each person gets the right page from their account, not from the address they
type.

---

## Test 2 — A student sees only their own courses (2 minutes)

1. Sign in as `student1@example.test`.
2. Look at **My courses**.

**What should happen:** you see the course from Instructor 1. You see the teacher's name, the
status, and an **Open course** button.

**What should also happen — and this is the point:** you do **not** see:
- any button to make a new course
- any Edit or Delete button
- any list of other students
- any settings for the AI

3. Sign out and sign in as `student3@example.test`.

**What should happen:** you see a different course. You do **not** see Student 1's course.

---

## Test 3 — A student can take a lesson (5 minutes)

1. Sign in as `student1@example.test`.
2. Click **Open course** on any course.

**What should happen:** the classroom opens. You see a slide, an AI teacher, and AI classmates.

3. Press the **Play** button under the slide.

**What should happen:** the AI teacher starts to speak the lesson. The notes panel on the right
highlights the sentence being spoken.

**Why this matters:** this is the original OpenMAIC classroom. Adding accounts did not break it.

---

## Test 4 — An instructor can manage their class (5 minutes)

1. Sign in as `instructor1@example.test`.
2. Look at your course. You should see the number of students, the co-instructors, and the time of
   the last activity.
3. Click **Manage students**.

**What should happen:** you see the students in the course, with their student numbers. You can add
a student by typing their email, and you can deactivate one.

4. Click **Close**, then click **Results**.

**What should happen:** you see each student with how many sessions and how many interactions they
have had.

5. Click **View trajectory** on a student who has used the classroom.

**What should happen:** you see what that student did, in time order, with what the AI said back.

**Important:** if Student 1 took the lesson in Test 3 and Student 2 did not, you should see that
Student 1 has interactions and Student 2 has none. Their data is separate.

---

## Test 5 — An instructor cannot see another teacher's class (3 minutes)

This is the most important test.

1. Sign in as `instructor1@example.test`. Write down which courses you see.
2. Sign out. Sign in as `instructor2@example.test`.

**What should happen:** you see a **different** course. Instructor 1's course is **not** in your
list.

3. While signed in as Instructor 2, try to open Instructor 1's course directly. Take the web address
   of that course and type it into the address bar.

**What should happen:** you are refused. You do not see the course.

**Why this matters:** knowing the address of a course is not enough to open it. Before this level,
it was.

---

## Test 6 — Export the class data (2 minutes)

1. Sign in as `instructor1@example.test`.
2. Open **Results** on your course.
3. Click **Export CSV**.

**What should happen:** a file downloads. Open it in Excel or Google Sheets.

**What you should see:** one row for each thing a student did, with the course, the student number,
the time, what the student wrote, and what the AI replied.

**What you will also see:** some columns are empty — quiz and PBL columns. This is on purpose. The
system has not produced any quiz or project records yet, and we do not put made-up values into an
export. See the limits document for more.

---

## Test 7 — The administrator can manage people (3 minutes)

1. Sign in as `admin@example.test`.

**What should happen:** you see all six accounts with their roles, and all courses on the platform.

2. Try to change **your own** role using the dropdown on your own row.

**What should happen:** you cannot. The control is switched off for your own row.

**Why this matters:** if the last administrator could lower their own role, nobody could manage the
platform afterwards.

---

## Test 8 — The security tests (for a technical reader)

All the checks above, and many more, run automatically. There are 41 of them and they all pass
against the live website.

```bash
cd ~/Downloads/OpenMAIC
BASE_URL=https://openmaic-level2.vercel.app node scripts/level2-security-tests.mjs
```

The script makes its own courses and students each time it runs, so it does not depend on data left
by earlier tests. It checks things a person cannot easily check by clicking, such as:

- A student sending a request that pretends to be another student. This is refused.
- A student asking for another student's answers directly. This is refused.
- Someone with no account asking for anything at all. This is refused.

---

## If something does not work

| What you see | What it usually means |
|---|---|
| A student says a course is missing | The course is not published yet, or the student is not enrolled. The instructor can fix both. |
| Sign-in is refused and the password is right | The account may be waiting for an administrator to approve it. |
| A course page shows an error once | Reload the page. If it continues, tell Duy. |
| Making a new course does nothing | The AI key may have run out of credit. |

---

## What you should look at first

If you only have ten minutes, do **Test 2**, **Test 3** and **Test 5**. Together they show the three
things that matter most: a student sees only their own courses, the classroom still works, and one
teacher cannot reach another teacher's class.
