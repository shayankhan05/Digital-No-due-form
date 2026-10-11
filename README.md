# Digital No-Due Form

Existing HTML/CSS/vanilla JavaScript mobile application, migrated to **Firebase Authentication + Firebase Hosting + Express + MongoDB**. The UI/theme and exact subject-teacher/No-Due workflow are preserved. The frontend has no npm build step and never connects directly to MongoDB.

Start with [the complete MongoDB migration, local testing and deployment guide](docs/MONGODB-MIGRATION.md). It contains the changed-file inventory, collections/indexes, API routes, token/role authorization, migration results, exact PowerShell commands and Atlas/Render/Firebase preparation. Nothing has been deployed automatically.

## Run locally (PowerShell)

Use the project root, **not** `tests/` or `legacy-firestore/`. Node.js 22+ and installed Google Chrome are required. On the first setup only, run `npm --prefix tests ci` and `npm --prefix server ci`.

Terminal 1:

```powershell
Set-Location "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form"
npm run local
```

Wait for `Local app ready`. Terminal 2:

```powershell
Set-Location "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form"
npm run seed
```

Open **http://127.0.0.1:5050/login.html**. API health: http://127.0.0.1:3000/health. Auth UI: http://127.0.0.1:4500/auth.

`local` starts the persistent MongoDB replica set (or reuses an already-running local instance), Firebase Auth/Hosting using the **root** config, and Express. It imports `server/auth-emulator-backup` automatically. Stop it with **Ctrl+C and wait for the Auth export to complete**; do not force-close the terminal. If a required app port is occupied, the script stops without killing that service: close its owning terminal normally before starting this workflow. Keep a correctly running `npm run local` session for ordinary testing; a data reset is unnecessary.

`seed` is restricted to project `demo-digital-no-due`, Auth `127.0.0.1:9199`, and Mongo database `digital_no_due_dev` on `127.0.0.1`. It restores only missing saved Auth identities, retaining their UID/password hash. Existing accounts/passwords are never reset. It restores the saved migration export only when the application database is empty. These saved exports are local, gitignored backups: a new machine must receive them securely if it needs these exact existing identities. A repeated seed in the repaired environment reports `restoredAuth: 0` and `insertedApplicationRecords: 0`.

The prior invalid-password problem had two causes: an empty Auth emulator while institutional records remained in MongoDB, and a leftover Firebase process serving the archived Firestore frontend. Auth was restored from the saved export and the active frontend now uses Express/MongoDB. Do not use archived Firestore seed/start instructions for the current app.

## Demo logins verified in Chrome

These **local demo** accounts use `DemoPassword123!` in the restored session:

| Role | Email / identifier |
|---|---|
| Admin | admin@demo.test |
| Student | student@demo.test |
| Subject faculty | subject_faculty@demo.test |
| Mentor | mentor@demo.test |
| HOD | hod@demo.test |
| Office | office@demo.test |
| Library | library@demo.test |
| Accounts | accounts@demo.test |
| Imported student, Ayesha | ise-demo-1ay24is158@demo.test **or** 1AY24IS158 |
| Imported teacher, Sana | sana.mir@demo.test **or** FAC204 |

New default-password accounts must change their password before continuing. Seed also repairs missing flags on locally seeded demo profiles using provisioning provenance and Auth metadata. Explicitly completed accounts and accounts with evidence of a subsequent password change are skipped. Startup runs this policy before exposing the API and rebases pending flags after an emulator import. Seed never resets credentials. Firebase handles credential verification, updates and resets. USN/employee-ID lookup is server controlled and case insensitive; incorrect/unknown credentials receive the same error.

Install and test:

```powershell
npm --prefix tests ci
npm --prefix server ci
npm --prefix server test
```

Tests require Google Chrome and the existing frontend Hosting server on 5050. They use isolated Auth 9298, test API 3001 and a temporary MongoDB replica set, not current demo data. See the guide for first-time startup commands.

From the root, `npm test` runs the same isolated suite. The first run may download the MongoDB test binary. Never point automated fixtures at the main demo database/Auth ports. Browser tests use installed **Google Chrome**, including real forms, CSV downloads/uploads, password changes and the full approval workflow.

## New workflows

**Bulk marks:** teacher → academic page → select assigned class → **Export Marks CSV** → edit assessment values → choose **Import Marks CSV** file → **Validate & Preview** → review row errors/warnings → check confirmation → **Confirm & import marks**. Headers come from that offering's configured assessments. Blank/omitted assessment cells preserve existing values. Invalid rows are visibly reported and skipped; the server revalidates every import. **All students & marks** shows the complete roster table. Students see imported values after their normal academic refresh. Exports/imports never change enrollments.

**Requests:** deterministic approval IDs plus logical subject/teacher/cohort deduplication prevent identical teacher items. Distinct subjects retain separate codes/names. A student can have only one active request (including rejected requests awaiting resubmission, and cleared requests awaiting Office); simultaneous creates are transaction guarded. Retry submission keys reuse the same request. After issuance, the normal new-request flow is available again. Repeated identical approval/issuance actions are safe. The existing rejection/resubmission history is preserved.

**Password UI:** login, change-password and the new `reset-password.html?oobCode=...` page have keyboard-accessible show/hide buttons. The mandatory change is enforced both by navigation and the API. Only a verified Firebase password update clears the server flag; clients/admin record editing cannot clear it. No plaintext passwords are stored. Firebase's default reset/activation action handler remains supported; selecting the custom reset page for production email links requires Firebase Console email-action URL configuration. Nothing has been deployed/configured in production by this change.

**Layout:** authenticated shells now expand responsively up to 1800px, with responsive outer gutters and full width on phones. Login cards remain 360px. Tables scroll inside their cards, long identifiers wrap, dynamic password controls stay within inputs, and the marks toolbar stacks on phones. Existing colors, fonts, cards and theme modes are retained. See [the three-issue verification and file inventory](docs/THREE-ISSUES-FIX.md).

The backend reads `server/.env` (copy `.env.example` once). Auth tokens are verified by Firebase Admin; roles come from MongoDB institutional profiles. Local demo provisioning uses `DemoPassword123!`; production provisioning sends activation/password-reset email and stores no plaintext password.

Students see their own profile/subjects/marks/requests. Teachers see only assigned offerings and enrolled students. Mentors see mentees and any separately assigned teaching classes. Admin provisioning and student/teacher/offering CSV imports remain available. Office retains indexed name/partial name/USN/email searches, duplicate counts, filters and issuance status.

The approval sequence remains: exact subject teachers + Library + Accounts in parallel → Mentor → HOD → Office → Hall Ticket Issued. Physics and Chemistry labs are excluded. Rejection reasons, owner-only notifications and resubmission remain supported.

`legacy-firestore/` retains the prior working source and original README for rollback. Old Firestore seed/repair guides and scripts describe that version; they are not startup instructions for this migrated application. Active `firebase.json` configures only Auth/Hosting and excludes the backend, secrets, exports and legacy archive from Hosting.
