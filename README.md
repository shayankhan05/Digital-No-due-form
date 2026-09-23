# Digital No-Due — working code

This is a real, runnable implementation of the app from your Stitch designs and the 10-day guide: plain HTML/CSS/JavaScript + Firebase (Auth + Firestore + Hosting only — no billing card, ever). No npm install, no build step. Read this top to bottom before running anything — it's short.

## What's in this folder

```
login.html                 Login
student-dashboard.html     Student's status tracker
create-request.html        Submit a new request
approver-dashboard.html    Shared queue: subject faculty, library, labs, accounts
mentor-dashboard.html      Mentor's soft-skill approval
hod-dashboard.html         Coordinator/HOD final approval
office-dashboard.html      Hall ticket verification

css/style.css              All styling (the navy/white theme from your designs)
js/firebase-config.js      ← you edit this first
js/auth.js                 Login, logout, route guard, role-based redirect
js/workflow.js             The actual hierarchy logic — read this file to understand the app
js/student.js               |
js/create-request.js        |  one file per page, wired to workflow.js
js/approver.js               |
js/mentor.js                 |
js/hod.js                    |
js/office.js                 |

firestore.rules             Security rules
firebase.json                Hosting + rules deploy config
manifest.json                Makes it installable as a PWA
```

---

## Step 1 — Create the Firebase project (5 minutes)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → give it a name → skip Google Analytics.
2. **Build → Authentication** → Get started → enable **Email/Password**.
3. **Build → Firestore Database** → Create database → start in **test mode** (you'll deploy the real rules in Step 5).
4. **Project settings (gear icon) → General → Your apps → Web (`</>`)** → register an app (no need for Hosting setup here) → copy the `firebaseConfig` object it shows you.

## Step 2 — Paste your config

Open `js/firebase-config.js` and replace the placeholder values with what you just copied. This file is safe to be public — it's an identifier, not a secret. Your real security is `firestore.rules`.

## Step 3 — Create test accounts and data

You need this before anything will show up on screen. Do it manually in the console for now (this is what the Admin panel would automate later).

**A. Create sign-in accounts** — Authentication → Users → Add user, for each of these (use any password, e.g. `test1234`):
- `student@test.com` (this will be your test student)
- `physics@test.com`, `library@test.com`, `mentor@test.com`, `hod@test.com`, `office@test.com`, plus one per subject teacher if you want to test more than one subject

Copy each user's **UID** from the console — you'll need it below.

**B. Create their profile documents** — Firestore Database → Start collection → `users` → document ID = the UID you copied:

```
users/{studentUid}
  role: "student"
  name: "Rahul S."
  usn: "1MS21CS001"
  semester: 6
  section: "B"
  mentorId: "{mentorUid}"     ← paste the mentor's UID here

users/{physicsUid}
  role: "physics_lab"
  name: "Prof. Anita R."

users/{libraryUid}
  role: "library"
  name: "Library Desk"

users/{mentorUid}
  role: "mentor"
  name: "Dr. Smith"

users/{hodUid}
  role: "hod"
  name: "Dr. Rao"

users/{officeUid}
  role: "office"
  name: "Exam Office"
```

For a subject teacher, also add `subjectCode` (must match one used in `js/workflow.js`, e.g. `"CS61"`):
```
users/{teacherUid}
  role: "subject_faculty"
  name: "Prof. Iyer"
  subjectCode: "CS61"
```

The default subjects configured in `workflow.js` are for Semester 6, Section B (`CS61`–`CS68`, matching your dashboard mockup: Computer Networks, DBMS, Software Engineering, System Software, Web Technology, Data Mining, Cloud Computing, Open Elective). Edit `REQUIRED_APPROVERS_BY_KEY` in `js/workflow.js` to match your actual subjects/semesters — that object *is* your workflow configuration for now.

## Step 4 — Run it locally

You can't just double-click the HTML files — ES modules require a real server, even a local one.

1. Install the **Live Server** extension in VS Code.
2. Open this folder in VS Code.
3. Right-click `login.html` → **Open with Live Server**.
4. Log in as your test student and walk through: submit a request → open a second browser tab (or an incognito window) → log in as `physics@test.com` → approve/reject → watch the student dashboard update live.

**The full chain to test:** student submits → all Stage 1 approvers act → mentor's queue picks it up automatically → mentor approves → HOD's queue picks it up → HOD approves → office searches the USN → sees "Eligible" → issues the ticket.

**If a screen shows a Firestore error mentioning "index"** — this is normal and expected the first time. Firestore prints a direct link in that error message; click it, click "Create index," wait about a minute, refresh. This happens for the approver, mentor, and HOD queues since they filter on more than one field.

## Step 5 — Deploy the security rules

Test mode (from Step 1) allows anyone to read/write everything — fine for local testing, not fine to ship. Deploy the real rules:

```
npm install -g firebase-tools
firebase login
firebase use --add        # pick your project when prompted
firebase deploy --only firestore:rules
```

## Step 6 — Deploy the app itself

```
firebase deploy --only hosting
```

You'll get a live URL like `your-project.web.app`. Open it on a phone and use the browser menu → **Add to Home Screen** — it now behaves like an installed app, for free, with no Play Store involved.

---

## How the hierarchy actually works (read this to understand, not just copy-paste)

Every request moves through exactly these statuses, in `js/workflow.js`:

```
pending_stage1  →  pending_mentor  →  pending_hod  →  cleared  →  issued
      ↓                  ↓                ↓
                     rejected
```

- **Stage 1** (`approver.js`) — subject faculty, library, labs, accounts each own one document in the request's `approvals` subcollection. They act independently; nothing is gated between them.
- After every Stage 1 approve/reject, `checkAndAdvance()` re-checks all Stage 1 items. Any rejection → `rejected`. All approved → `pending_mentor`.
- **Mentor** (`mentor.js`) only ever queries for requests already at `pending_mentor` — so a mentor literally cannot act early, there's nothing for them to query.
- Same pattern for **HOD** (`hod.js`) at `pending_hod`, and **Office** (`office.js`), which only enables its "Issue" button when `status === "cleared"`.

This is what "the hierarchy can't be skipped" actually looks like in code — not a UI restriction, but each screen's query literally can't see a request that isn't at the right stage yet.

## What's intentionally not built yet

Matches "cut for v2" in the 10-day guide: Admin panel (use the Firestore console), configurable workflow builder (edit the object in `workflow.js` instead), QR codes, PDF certificates, push notifications, audit log screen. The data model already has what a v2 audit log or notification system would read from (`actedBy`, `actedAt`, `remarks` on every approval) — you're not blocked on adding those later.
