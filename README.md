# Digital No-Due – Smart College Clearance & Approval Management System

Digital No-Due manages college clearance with semester-aware academic administration, CSV imports, faculty and mentor assignments, marks, staged approvals, rejection/resubmission and audited maintenance.

The HTML/CSS/JavaScript frontend runs on Firebase Hosting. Firebase Authentication verifies credentials. The Express backend runs on Render and stores application data in MongoDB Atlas. Browsers access MongoDB only through the authenticated API.

## Roles and workflow

Students request clearance. Assigned subject faculty, Library, Accounts and Sports approve Stage 1 in any order. Every required Stage 1 item must be approved before Mentor, then HOD, then Office/final issuance. Physics and Chemistry labs default to required in Semesters 1–2 and optional/off in Semesters 3–8. Administrators can configure lab requirements per department/semester. Existing requests retain their saved requirements and history.

Faculty may also be mentors without a second identity. Department Admins manage their department with a Semester 1–8 context. Super Admin manages institution configuration, reviews, request resets and explicitly confirmed maintenance. Service approvers see their assigned clearance work.

## Local setup (PowerShell)

Use Node.js 22+ and installed Google Chrome. From the repository root:

```powershell
npm --prefix tests ci
npm --prefix server ci
npm run local
```

Wait for Local app ready. In a second terminal, use npm run seed only when restoring the approved local demo environment. Open http://127.0.0.1:5050/login.html. Local health: http://127.0.0.1:3000/health. Auth emulator UI: http://127.0.0.1:4500/auth.

Startup reuses a working local MongoDB replica set and imports the ignored Auth emulator backup. Stop normally with Ctrl+C and wait for export. Do not force-close or reset a working environment. Seed is restricted to the local demo project/database and restores missing identities without resetting existing passwords. A new machine needs the local backups supplied securely.

Copy server/.env.example to the ignored server/.env for local configuration. Variables: MONGODB_URI, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_WEB_API_KEY, PORT, FRONTEND_ORIGIN, optional SMTP_PASSWORD, and TEST_DATA_BACKUP_KEY for encrypted administrative backups. FIREBASE_AUTH_EMULATOR_HOST is local-only and must not be set in production. Never commit environment files, private keys, credentials or database exports.

## Authentication and imports

Creation reserves unique identifiers, creates/links the matching Firebase UID and completes the application profile. Imports use stable jobs and checkpoints for retry safety. Students log in by email or USN; faculty/staff by email or Employee ID. Existing accounts retain their UID and history. Conflicting institutional identities are blocked.

Production accounts use activation/password-reset email. An explicitly enabled institution demo policy can initialize demo-address accounts for testing. Temporary-password reminders and Firebase password-change/reset flows remain available. Passwords are not documented here or stored in application records.

Student reconciliation previews distinguish new, existing, inactive and conflicting identities. Review department/semester, mappings, warnings and conflicts before confirming an import. Marks CSV imports preserve omitted values and enrollments. IA1/IA2 maxima are 25 and Assignment is 10; historical values are not automatically reduced.

## Tests

```powershell
npm test
```

The existing suite uses isolated Firebase Auth on 9298, temporary MongoDB replica sets, test APIs and real Chrome. It covers provisioning/login, authorization, imports, semester isolation, academics, all clearance stages, rejection/resubmission and resets. Never redirect fixtures to production. The first run may download the MongoDB test binary.

## Deployment

Frontend: https://digital-no-due-shayan.web.app

Backend health: https://digital-no-due-form.onrender.com/health

The existing GitHub Actions workflow deploys Firebase Hosting on main. Render uses server/, npm ci and npm start, with environment values configured securely in Render. Hosting excludes Git/deployment metadata, backend code, dependencies, environment files, private keys and audit/backup output. Verify the live backend revision and frontend files after a release. Deployments require no academic imports or data migrations.

## Guides and archive

See [local/MongoDB setup](docs/MONGODB-MIGRATION.md), [college data imports](docs/college-data-import.md), [provisioning](docs/PROVISIONING.md), [department setup/access](docs/department-setup-and-access.md), and [reviewed test-data maintenance](docs/test-data-cleanup.md). Older guides describe historical releases. The legacy-firestore/ rollback archive is excluded from Hosting; its startup instructions do not apply to the active application.
