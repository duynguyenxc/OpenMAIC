# How to Test the Platform

**OpenMAIC teaching platform — Level 2**
Duy Nguyen · 2026-10-16

You do not need to install anything. You need a web browser and this page.

**Open this link:** https://openmaic-level2.vercel.app

The first thing you see is a **Sign in** box. That is correct. There is no public sign-up, and there
is no shared code to type any more. Every person signs in with their own account, and the account
decides what they are allowed to see. The accounts you need are listed below.

---

## 1. The test accounts

Six accounts are already made for you. Copy the email and the password exactly.

| Role | Email | Password |
|---|---|---|
| **Administrator** | `admin@example.test` | `T2-0qLYeKyArSOg` |
| **Instructor** | `instructor1@example.test` | `T2-J2FbpEUaChbV` |
| **Instructor** | `instructor2@example.test` | `T2-f8EJuKrdjmiB` |
| **Student** | `student1@example.test` | `T2-Zh-Wyu-g6-BP` |
| **Student** | `student2@example.test` | `T2-OEhQCDyT8meI` |
| **Student** | `student3@example.test` | `T2-IdUWRcNGsgWm` |

These are throwaway accounts on a test website. They are not used anywhere else, and you should not
reuse these passwords anywhere else. Tell Duy if you want them changed; it takes one command.

**What each role can do**

| Role | Can do |
|---|---|
| Administrator | See every account and every course. Change a person's role. Turn an account off. |
| Instructor | Make courses, teach them, add students, read their own students' work. Nothing of another instructor's. |
| Student | Open the courses they are enrolled in. Nothing else. |

**How the test data is arranged**

- **Instructor One** owns the course **"Demo 1 — Realist Evaluation (Instructor One)"**.
  Student One and Student Two are enrolled in it. Student One has already taken the lesson, so there
  is real data to look at.
- **Instructor Two** owns **"Demo 2 — Instructor Two private course"**. Student Three is in it.
  Instructor One and Students One and Two have nothing to do with it.

You will also see other courses with names like *Course A*, *Course B* and *Untitled course*. Those
are left over from the automated security runs. Ignore them; use the two **Demo** courses.

---

## 2. The short walkthrough (about 15 minutes)

Follow this from top to bottom. After each step there is a line saying what should happen. If
something different happens, that is a finding — please tell Duy.

### Step 1 — You are not let in without an account

1. Open https://openmaic-level2.vercel.app

**Should happen:** you land on the **Sign in** box, not on a classroom and not on an error.

*(This was broken until 16 October: a visitor with no account saw the message "Persistence is
unavailable". It is fixed; this step checks the fix.)*

### Step 2 — The account decides the page, not the address

2. Sign in as **`admin@example.test`**.

**Should happen:** you land on the **Administrator** page. You did not pick it; the system read your
account and sent you there.

3. Look at the top table, **Users**. Six people, each with a role and a status.
4. Look at the lower table, **All courses**. Every course on the platform, with its owner, how many
   students it has, and when it was last used.
5. Try to change **your own** role with the dropdown on your own row.

**Should happen:** you cannot. Your own row is switched off, so the last administrator cannot lock
everybody out by mistake.

6. Click **Sign out**.

### Step 3 — An instructor sees only their own courses

7. Sign in as **`instructor1@example.test`**.

**Should happen:** you land on the **Instructor** page, titled *My courses*. Every course listed
belongs to Instructor One. **"Demo 2 — Instructor Two private course" is not there.**

8. Find **"Demo 1 — Realist Evaluation (Instructor One)"**. It should say *Students: 2*.

### Step 4 — The class roster

9. On that course, click **Manage students**, then scroll to the bottom of the page. The panel opens
   there.

**Should happen:** Student One and Student Two, each with a student number (JSU-00001, JSU-00002).

10. In the box, type `student3@example.test` and click **Add student**.

**Should happen:** the message *Enrolled student3@example.test*, and a third row appears.

11. Click **Deactivate** on that new row.

**Should happen:** the row turns **INACTIVE** and the button becomes **Reactivate**. Nothing is
destroyed; access is only turned off, and you can turn it back on.

### Step 5 — What the students actually did

12. Click **Close**, then click **Results** on the same course, and scroll to the bottom again.

**Should happen:** one row per student, with how many sessions and how many interactions each one
had, and the time of their last activity. Student One has activity; Student Three has none.

13. Click **View trajectory** on **Student One**.

**Should happen:** the real transcript appears — every message, with a date and time, exactly as it
was saved. This is the record of one student's learning, and only their instructor can open it.

14. Click **Export CSV**.

**Should happen:** a file downloads. Open it in Excel. One row per thing a student did, with the
course, the student number, the time, what the student wrote, and what the AI replied.

Some columns — the quiz and project columns — are **empty**. That is deliberate. The system has not
produced any quiz or project records yet, and we do not write invented values into an export. The
limits document explains this.

15. Sign out.

### Step 6 — The classroom still works

16. Sign in as **`student1@example.test`**.

**Should happen:** the **Student** page. Only courses this student is enrolled in. There is no button
to make a course, no Edit button, no list of other students, and no AI settings.

17. Click **Open course** on **"Demo 1 — Realist Evaluation (Instructor One)"**.

**Should happen:** the classroom opens with a slide, an AI teacher (Dr. Maya Bennett) and AI
classmates. The lesson is about realist evaluation and the Context–Mechanism–Outcome idea.

18. Press the round **Play** button in the middle of the slide.

**Should happen:** the teacher starts speaking, and the text panel at the bottom follows along.

This is the original OpenMAIC classroom, untouched. Adding accounts did not break it. Anything the
student does here is written to that student's own record — which is what you just read in Step 5.

### Step 7 — The test that matters most

19. Still signed in as Student One, put this address in the address bar:

```
https://openmaic-level2.vercel.app/classroom/Te0sq0vfz
```

That is Instructor Two's course — a course this student is **not** enrolled in.

**Should happen:** you are refused, with the message *document authorization required*. You do not
see the course.

The refusal comes from the server, not from the page. Hiding a button is not security; the server
checks every single request against the enrolment list. Before this level, knowing the address was
enough to open any course.

20. To see the same fence between two teachers: sign out, sign in as
    **`instructor2@example.test`**, and look at *My courses*. Instructor One's Demo 1 is not listed.
    Then try to open it by address:

```
https://openmaic-level2.vercel.app/classroom/Tdm20whad
```

**Should happen:** refused again.

---

## 3. The automatic security tests (for a technical reader)

Everything above, and much more, runs without a person clicking. There are 41 checks and they all
pass against the live website.

```bash
cd ~/Downloads/OpenMAIC
BASE_URL=https://openmaic-level2.vercel.app node scripts/level2-security-tests.mjs
```

The script makes its own courses and students each time, so it does not depend on data left behind
by earlier runs. It checks things a person cannot easily check by clicking:

- A student sending a request that claims to be a different student → refused.
- A student asking for another student's saved answers directly → refused.
- A student trying to create a course → refused, and nothing half-made is left behind.
- Someone with no account asking for anything at all → refused.

---

## 4. If something does not look right

| What you see | What it usually means |
|---|---|
| A student says a course is missing | The course is not published, or that student is not enrolled. The instructor can fix both. |
| Sign-in refused and the password is right | The account may be waiting for an administrator to approve it. Check **Status** on the Administrator page. |
| A page shows an error once | Reload. If it keeps happening, tell Duy — with the address you were on. |
| An error message that looks like code | The refusals are correct but the wording is raw. Making them friendly is on the list, and it is cosmetic, not a security problem. |
| Making a new course does nothing | The AI key may have run out of credit. |

---

## 5. If you only have ten minutes

Do **Step 6**, then **Step 7**, then **Step 5**. Together they show the three things that matter:
the classroom still teaches, one person cannot reach another person's class even with the address,
and the instructor can see exactly what their own students did.

There is also a recorded walkthrough of all of this, as a short animation:
`docs/demo/level2-walkthrough.gif`.
