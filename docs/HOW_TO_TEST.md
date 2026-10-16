# OpenMAIC Teaching Platform — What It Does, and How to Test It

**Level 2 · Duy Nguyen · 16 October 2026**

## The link

### → https://openmaic-level2.vercel.app

Nothing to install. A web browser is all you need. The accounts are in Part 2.

The first screen is a **Sign in** box. That is correct — the platform has no public sign-up, and
the shared code used at Level 1 is gone. Every person signs in as themselves, and their account
decides what they are allowed to see.

---

# Part 1 — What the platform does

OpenMAIC on its own is a single AI classroom: you ask it for a lesson and it teaches you. It has no
idea who you are, and anybody with the address can open anything. Level 2 turns that into a
platform a real class can use.

### Accounts and roles

Three roles. An administrator creates the accounts; nobody can sign themselves up.

| Role | What they can do |
|---|---|
| **Administrator** | See every account and every course. Change a person's role. Turn an account off. |
| **Instructor** | Create and publish courses, enrol students, read their own students' work. |
| **Student** | Open the courses they are enrolled in — and nothing else. |

You never choose which page you get. You sign in, and the system sends you to the page your account
belongs to.

### For the instructor

- Build a course with the OpenMAIC AI, then **publish** it to the class.
- **Enrol students** by email address, and remove access again without destroying anything.
- See, for each student, how many sessions and how many interactions they have had.
- Open **the full transcript** of one student's lesson — every message, with its time.
- **Export** the whole class as CSV or JSON, for a spreadsheet or for analysis.
- **Duplicate** a course to make a second section of it.
- Add a co-instructor to a course.

### For the student

- A list of **only** the courses they are enrolled in.
- The OpenMAIC classroom itself, unchanged: the AI teacher, the slides, the AI classmates.
- No course list, no other students, no editing, no AI settings.

### For the administrator

- Every account, with its role and status, on one page.
- Change a role, or deactivate an account — except their own role, so the last administrator cannot
  lock everybody out.
- Every course on the platform, with its owner, its student count and its last activity.

### What is protected, and how

This is the part that matters, and it is not done by hiding buttons.

- One instructor **cannot** reach another instructor's course, even with the exact address.
- One student **cannot** reach another student's work, even by asking the server directly.
- A student **cannot** create a course, change one, or send a request pretending to be a classmate.
- Someone with no account gets nothing at all.

Every one of these is checked by the **server**, on every single request. There are **41 automated
security tests**; all 41 pass against the live website, last run on 16 October 2026.

---

# Part 2 — The accounts

Six accounts are already made. Copy the email and the password exactly.

| Role | Email | Password |
|---|---|---|
| **Administrator** | `admin@example.test` | `T2-0qLYeKyArSOg` |
| **Instructor One** | `instructor1@example.test` | `T2-J2FbpEUaChbV` |
| **Instructor Two** | `instructor2@example.test` | `T2-f8EJuKrdjmiB` |
| **Student One** | `student1@example.test` | `T2-Zh-Wyu-g6-BP` |
| **Student Two** | `student2@example.test` | `T2-OEhQCDyT8meI` |
| **Student Three** | `student3@example.test` | `T2-IdUWRcNGsgWm` |

These are throwaway accounts on a test website. They are used nowhere else, and these passwords
should not be reused anywhere else. They can be changed in one command if you prefer.

**How the test data is arranged**

- **Instructor One** owns **"Demo 1 — Realist Evaluation (Instructor One)"**. Student One and
  Student Two are in it. Student One has already taken the lesson, so there is real work to look at.
- **Instructor Two** owns **"Demo 2 — Instructor Two private course"**, with Student Three in it.
  Instructor One and Students One and Two have nothing to do with it.

You will also see courses named *Course A*, *Course B* and *Untitled course*. Those are left behind
by the automated security tests, which build their own courses every time they run. Ignore them and
use the two **Demo** courses.

---

# Part 3 — Testing it, step by step

About twenty minutes, top to bottom. Each step says what should happen. **Anything different is a
finding — please tell me.**

### Before you start

Open the link in a **private window** — Chrome: ⌘⇧N on a Mac, Ctrl+Shift+N on Windows. A private
window remembers nothing, so you see exactly what a brand-new visitor sees. In a normal window, if
you signed in here before, the site lets you straight through and Step 1 will not show what it is
meant to show.

### Step 1 — No account, no entry

Open https://openmaic-level2.vercel.app

> **Should happen:** the **Sign in** box. Not a classroom, and not an error message.

### Step 2 — The account picks the page

Sign in as **`admin@example.test`**.

> **Should happen:** the **Administrator** page opens by itself. You never chose it.

Look at **Users** — six people, each with a role and a status. Then **All courses** — every course
on the platform, with its owner and its student count.

Now try to change **your own** role, using the dropdown on your own row.

> **Should happen:** you cannot. Your own row is switched off, so the last administrator cannot
> remove their own powers by accident.

Click **Sign out**.

### Step 3 — An instructor sees only their own work

Sign in as **`instructor1@example.test`**.

> **Should happen:** the **Instructor** page, *My courses*. Every course listed belongs to
> Instructor One. **"Demo 2 — Instructor Two private course" is not there.**

Find **"Demo 1 — Realist Evaluation (Instructor One)"**. It should say *Students: 2*.

### Step 4 — The class roster

On that course click **Manage students**, then **scroll to the bottom of the page** — the panel
opens there.

> **Should happen:** Student One and Student Two, each with a student number (JSU-00001, JSU-00002).

In the box type `student3@example.test` and click **Add student**.

> **Should happen:** the message *Enrolled student3@example.test*, and a third row appears.

Click **Deactivate** on that new row.

> **Should happen:** the row becomes **INACTIVE** and the button becomes **Reactivate**. Nothing is
> destroyed — access is turned off, and you can turn it back on.

### Step 5 — What the students actually did

Click **Close**, then **Results** on the same course, and scroll to the bottom again.

> **Should happen:** one row per student — sessions, interactions, and the time of their last
> activity. Student One has activity. Student Three has none.

Click **View trajectory** on **Student One**.

> **Should happen:** the real transcript — every message, with its date and time, exactly as it was
> saved. This is one student's record, and only their own instructor can open it.

Click **Export CSV**.

> **Should happen:** a file downloads. In Excel: one row per thing a student did, with the course,
> the student number, the time, what the student wrote and what the AI replied.

Some columns — quiz and project — are **empty**. That is deliberate: the system has not produced
any quiz or project records yet, and we do not write invented values into an export.

Click **Sign out**.

### Step 6 — The classroom still teaches

Sign in as **`student1@example.test`**.

> **Should happen:** the **Student** page, showing only the courses this student is enrolled in.
> There is no button to create a course, no Edit button, no list of other students, no AI settings.

Click **Open course** on **"Demo 1 — Realist Evaluation (Instructor One)"**.

> **Should happen:** the classroom opens — a slide, an AI teacher (Dr. Maya Bennett) and AI
> classmates. The lesson is about realist evaluation and the Context–Mechanism–Outcome idea.

Press the round **Play** button in the middle of the slide.

> **Should happen:** the teacher begins to speak, and the text panel at the bottom follows along.

This is the original OpenMAIC classroom, untouched — adding accounts did not break it. Everything
the student does here goes into that student's own record, which is what you read in Step 5.

### Step 7 — The test that matters most

Still signed in as Student One, put this in the address bar:

```
https://openmaic-level2.vercel.app/classroom/Te0sq0vfz
```

That is Instructor Two's course — one this student is **not** enrolled in.

> **Should happen:** refused, with the message *document authorization required*. You do not see the
> course.

The refusal comes from the server, not from the page. Hiding a button is not security; the server
checks every request against the enrolment list. Before this level, knowing the address was enough
to open anything.

Now the same fence between two teachers. Sign out, sign in as **`instructor2@example.test`** and
look at *My courses* — Demo 1 is not listed. Then try it by address:

```
https://openmaic-level2.vercel.app/classroom/Tdm20whad
```

> **Should happen:** refused again.

### Step 8 — Finding your way back

While still signed in, go to the bare address: https://openmaic-level2.vercel.app

> **Should happen:** OpenMAIC's own workspace — the screen where a teacher asks the AI to build a
> lesson. In the top-right corner there is a **Platform** button.

Click **Platform**.

> **Should happen:** you are back on your own page — instructor, student or administrator,
> whichever you are.

---

# Part 4 — If something does not look right

| What you see | What it usually means |
|---|---|
| A student says a course is missing | The course is not published, or that student is not enrolled. The instructor can fix both. |
| Sign-in refused and the password is right | The account may be waiting for an administrator to approve it. Check **Status** on the Administrator page. |
| The sign-in page does nothing when you press the button | This was a real bug, fixed on 16 October. If you still meet it, tell me at once — and say whether a second attempt works. |
| A refusal written in technical words | The refusals are correct, but the wording is still raw. Making them friendly is on the list. It is cosmetic, not a security problem. |
| A page shows an error once | Reload. If it keeps happening, tell me, with the address you were on. |
| Creating a new course does nothing | The AI key may have run out of credit. |

---

# Part 5 — The automated tests, for a technical reader

Everything above, and more that a person cannot easily click through, runs automatically:

```bash
cd ~/Downloads/OpenMAIC
BASE_URL=https://openmaic-level2.vercel.app node scripts/level2-security-tests.mjs
```

41 checks; all 41 passed against the live site on 16 October 2026. The script builds its own
courses and students on every run, so it never depends on data left by an earlier run. It covers,
among others:

- A student sending a request that claims to be a different student → refused.
- A student asking for another student's saved answers directly → refused.
- A student trying to create a course → refused, with nothing half-made left behind.
- Someone with no account asking for anything at all → refused.
- Two students in one course → their records never mix.

---

# Part 6 — If you only have ten minutes

**Step 6**, then **Step 7**, then **Step 5**. Those three show the three things that matter most:
the classroom still teaches, one person cannot reach another person's class even with the exact
address, and an instructor can see exactly what their own students did.

There is also a recorded walkthrough of the whole tour — sixteen captioned steps — in the
repository at `docs/demo/level2-walkthrough.gif`.
