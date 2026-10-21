# Administrator Manual

**OpenMAIC teaching platform — Level 2**

An administrator manages accounts and can see every course. Everything here is done at
`/platform`, which sends you to the administrator dashboard automatically.

---

![Users and every course](screenshots/06-admin-users-and-courses.jpg)

*The administrator dashboard: every account with its role and status, searchable, and every course
on the platform with its owner, co-instructors and student count. Manage opens the same panel the
instructor uses, on any course, which is how an administrator enrols a student or assigns an
instructor. Your own row is switched off, so the last administrator cannot demote themselves.*

## Signing in

Go to `/platform`. If you are not signed in you are sent to the sign-in page. Enter your email and
password; the platform decides which dashboard you belong to from your account, not from the
address you type, so there is no separate administrator URL to remember.

A shared access code is **not** used. Your account is the credential.

---

## Approving a new account

Someone who signs in for the first time without having been provisioned gets an account in
**PENDING** state, and is refused until you approve it. Pending accounts appear in a panel at the
top of your dashboard.

For each one, choose the role to approve them as:

- **Approve as STUDENT** — can open courses they are enrolled in, nothing more.
- **Approve as INSTRUCTOR** — can create courses and manage their own students.
- **Approve as ADMIN** — full platform administration.

Approving sets the role and marks the account ACTIVE in one step.

---

## Managing users

The **Users** table lists every account with its role, institution, student identifier and status.

- **Change a role** with the dropdown in the Role column. The change takes effect on that person's
  next request.
- **Activate or deactivate** with the button at the end of the row. A deactivated account cannot
  sign in to anything: every API call it makes is refused.

**Two things you cannot do, by design.** You cannot change your own role, and you cannot deactivate
your own account. Both are refused by the server as well as hidden in the interface. Without that,
the last administrator could demote themselves and leave the platform with nobody able to
administer it.

---

## Seeing every course

The **All courses** table lists every course on the platform with its owner, co-instructors,
student count, status and last activity. **Open** takes you into the classroom.

As an administrator you also reach every course-scoped function an instructor has — the student
list, the results, the export — without being added to the course. There is no separate
administrative screen for these; use the same addresses the instructor does.

---

## Creating accounts directly

Accounts can also be created without waiting for someone to sign in. The project script
`scripts/level2-seed-test-accounts.mjs` creates a set of accounts with profiles; for a classroom
pilot, adapt the account list at the top of that file. Passwords are written to
`.env.level2-test-accounts`, which is excluded from version control.

---

## What an administrator should know about the data

- Learner interaction is stored by OpenMAIC, keyed by course and by the learner's account.
- Nothing is duplicated into platform tables, so there is one copy of each record.
- Exports never contain passwords, API keys, tokens or database credentials.
- Database backups (`scripts/level2-db-backup.sh`) contain **password hashes and session rows**.
  Treat those files as credentials; they are excluded from version control.
