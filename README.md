# Digital No-Due Form

Existing HTML/CSS/vanilla JavaScript mobile application, migrated to **Firebase Authentication + Firebase Hosting + Express + MongoDB**. The UI/theme and exact subject-teacher/No-Due workflow are preserved. The frontend has no npm build step and never connects directly to MongoDB.

Start with [the complete MongoDB migration, local testing and deployment guide](docs/MONGODB-MIGRATION.md). It contains the changed-file inventory, collections/indexes, API routes, token/role authorization, migration results, exact PowerShell commands and Atlas/Render/Firebase preparation. Nothing has been deployed automatically.

Current local services: frontend `http://127.0.0.1:5050/login.html`, Express `http://127.0.0.1:3000/health`, Auth emulator `127.0.0.1:9199`, persistent MongoDB replica set `127.0.0.1:27017`. Keep the existing emulator session running; preserve/import its Auth export before a later restart so MongoDB-linked UIDs remain valid.

Install and test:

```powershell
npm --prefix tests ci
npm --prefix server ci
npm --prefix server test
```

Tests require Google Chrome and the existing frontend Hosting server on 5050. They use isolated Auth 9298, test API 3001 and a temporary MongoDB replica set, not current demo data. See the guide for first-time startup commands.

The backend reads `server/.env` (copy `.env.example` once). Auth tokens are verified by Firebase Admin; roles come from MongoDB institutional profiles. Local demo provisioning uses `DemoPassword123!`; production provisioning sends activation/password-reset email and stores no plaintext password.

Students see their own profile/subjects/marks/requests. Teachers see only assigned offerings and enrolled students. Mentors see mentees and any separately assigned teaching classes. Admin provisioning and student/teacher/offering CSV imports remain available. Office retains indexed name/partial name/USN/email searches, duplicate counts, filters and issuance status.

The approval sequence remains: exact subject teachers + Library + Accounts in parallel → Mentor → HOD → Office → Hall Ticket Issued. Physics and Chemistry labs are excluded. Rejection reasons, owner-only notifications and resubmission remain supported.

`legacy-firestore/` retains the prior working source and original README for rollback. Old Firestore seed/repair guides and scripts describe that version; they are not startup instructions for this migrated application. Active `firebase.json` configures only Auth/Hosting and excludes the backend, secrets, exports and legacy archive from Hosting.
