# MongoDB migration and operation

The frontend keeps its existing pages, theme, mobile shell, forms and Firebase Auth. Application data now goes through Express to MongoDB. No Firestore or Firebase Functions SDK is loaded by the active frontend. Nothing has been deployed to Atlas, Render or production Firebase.

## Current verified local state

Keep the existing Auth/Hosting emulator session running. Its Auth users retain their UIDs and passwords. The new API is at `http://127.0.0.1:3000`; frontend is at `http://127.0.0.1:5050/login.html`. MongoDB is a persistent local replica set, using `server/.mongo-data/dev`. The original Firestore emulator was read, never reset or written by the migration.

The read-only migration copied 1,709 source documents. A second run inserted zero and verified all 1,709 unchanged. Counts:

| Collection | Documents |
|---|---:|
| users | 222 |
| students | 388 |
| subjects | 16 |
| offerings | 23 |
| enrollments | 560 |
| marks | 14 |
| assignments | 5 |
| noDueRequests | 6 |
| approvals | 35 |
| notifications | 67 |
| institutionPolicy | 1 |
| clearancePlans | 118 |
| provisioningJobs | 80 |
| uniqueIdentities | 174 |

The derived Office search index was rebuilt. Six existing issued requests gained additive `hallTickets` history records in MongoDB. 119 legacy user-profile fixtures without matching Auth users are listed in `server/migration-output/migration-report.json`; they were preserved, not turned into new accounts. Existing Auth users: 103. All exported enrollment student/offering references resolved. The tool does not invent missing identities or silently repair unrelated fixtures. A separate fresh `digital_no_due_migration` database also accepted all 1,709 records with the final schema validators enabled.

`legacy-firestore/` contains the pre-migration HTML, CSS, JavaScript, Functions, rules and Firebase configuration. It is excluded from Hosting. This is a rollback copy, not a second active application. The original Functions/rules remain at the root too; active `firebase.json` deploys only Hosting and configures Auth/Hosting emulators. The current Auth emulator export is in ignored `server/auth-emulator-backup/`.

## Exact local commands (PowerShell)

Prerequisites: Node 22 or newer, installed Google Chrome, npm. Use separate terminals for long-running commands. Install once:

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form"
npm --prefix tests ci
npm --prefix server ci
if (!(Test-Path server/.env)) { Copy-Item server/.env.example server/.env }
```

The example `.env` already points to local MongoDB, demo Auth on 9199, API on 3000, and frontend on 5050. It contains no production credentials.

Terminal 1 — MongoDB, only if port 27017 is not already running:

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form\server"
npm run dev:mongo
```

This downloads a MongoDB binary on first use and starts a **persistent replica set**, required for transactions. Restarting this command reuses `.mongo-data/dev`; it does not clear it. An existing local replica set or Atlas dev database can instead be supplied through `MONGODB_URI`.

Terminal 2 — Auth + Hosting, **only after the current emulator session has ended**:

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form"
node tests/node_modules/firebase-tools/lib/bin/firebase.js emulators:start --project demo-digital-no-due --only auth,hosting --import server/auth-emulator-backup --export-on-exit server/auth-emulator-backup
```

Do not start a second instance over the current session. Importing the saved Auth export is essential: a blank Auth emulator would lose the identities linked to MongoDB. After creating more local accounts, update the export before stopping the running session:

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form"
node tests/node_modules/firebase-tools/lib/bin/firebase.js emulators:export server/auth-emulator-backup --project demo-digital-no-due --force
```

Terminal 3 — Express, only if port 3000 is not already running:

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form\server"
npm start
```

Health and application:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Start-Process "http://127.0.0.1:5050/login.html"
```

Use existing accounts/passwords; no current Auth credentials were changed. Examples: `admin@demo.test`, `office@demo.test`, `mentor@demo.test`, `sana.mir@demo.test`, `ise-demo-1ay24is158@demo.test`; existing demo password is `DemoPassword123!`. No new production password is supplied or stored.

Isolated tests, with the frontend Hosting process still serving port 5050:

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form\server"
npm test
npm audit --omit=dev
```

The test runner starts a separate Auth emulator (`demo-mongo-audit`, 9298), a temporary MongoDB replica set, and test API 3001. Chrome redirects test contexts to those services. It shuts those isolated services down afterward. `npm test`, `npm run audit` and `npm run test:all` in `tests/` also delegate to this MongoDB suite. Old Firestore seed/repair scripts are legacy maintenance tools, **not** commands for the migrated application.

## Read-only source migration

Already completed locally; do not rerun it as routine application startup. It requires the original Firestore emulator still running on 8180:

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form\server"
$env:SOURCE_PROJECT_ID="demo-digital-no-due"
$env:SOURCE_FIRESTORE_HOST="127.0.0.1:8180"
$env:SOURCE_AUTH_HOST="127.0.0.1:9199"
npm run migrate
```

It permits only loopback demo sources and target database names `digital_no_due_dev` / `digital_no_due_migration`. It recursively exports application documents, converts timestamps to BSON Dates, preserves document IDs and Firebase UIDs, inserts only absent records, verifies counts and references, and reports orphan identities. Existing differing target records cause an error instead of an overwrite. After legitimate MongoDB changes, an old-source re-import should therefore fail rather than replace newer data. Generated exports/reports contain student data and are gitignored and excluded from Hosting.

## Models, relationships and indexes

All `_id` values are stable strings; `users.firebaseUid` equals the Firebase Auth UID. Students retain UID-linked profiles. Offerings retain `subjectId`, `teacherId`, department, scheme, semester, section, active flag and assessment components. Enrollment IDs remain `<studentUid>__<offeringId>` with `studentId`, `offeringId`, exact `teacherId` and `mentorId`. Marks retain enrollment IDs and independent per-student `scores`; assignments retain offering references.

Requests retain IDs, student/mentor/HOD/Office ownership, `approvalItems`, `approvalStates`, rejection history and status. Flattened approval documents use `requestId/approvalId` as `_id` and `__parent` for request scoping. Notifications use `studentUid/eventId` and `__parent` for owner scoping. `institutionPolicy` holds former settings; `clearancePlans` holds derived student plans. `hallTickets` stores immutable issuance records. `uniqueIdentities` and provisioning jobs preserve retry reservations. MongoDB schema validators accept legacy optional metadata while domain services validate complete new records.

Indexes cover student USN/email/cohort/mentor, teacher offerings, active enrollment ownership, marks, assignments, request ownership/status, approvals and notifications by parent, and hall tickets by student/date. The Office search collection has indexed normalized search keys/trigrams plus email/USN keys. Case-insensitive partial names, duplicate counts, filters and statuses retain their existing behavior. No Firestore indexes are used by the live API.

Mongo transactions serialize concurrent approvals and atomically update requests, notification events, approvals and issuance. Provisioning preserves Auth UIDs, maps students to matching active offerings, and active offering imports backfill matching existing students. Repeated imports preserve existing enrollment/marks records.

## API routes and authorization

| Method / route | Purpose |
|---|---|
| GET `/health` | Mongo connectivity; public |
| GET `/api/auth/profile` | Token-verified institutional identity |
| POST `/api/admin` | Policy, previews, provision, teacher/offering imports, mapClass, retryActivation, directory |
| POST `/api/students/workflow` | Own/admin academic and clearance refresh |
| POST `/api/office/search` | Office/admin indexed search |
| POST `/api/requests` | Student submits own request |
| POST `/api/requests/:id/actions` | stage1, mentor, hod, issue, resubmit |
| GET `/api/students`, `/api/teachers`, `/api/offerings`, `/api/enrollments`, `/api/marks`, `/api/assignments`, `/api/requests`, `/api/hall-tickets` | Scoped resources; corresponding `/:id` reads supported |
| GET `/api/notifications` | Own notifications |
| GET `/api/requests/:id/approvals` | Authorized request approvals |
| PUT `/api/marks/:id` | Assigned teacher/admin validated marks update |
| POST `/api/data/read`, `/query`, `/write` | Validated, scoped compatibility transport for unchanged frontend pages |

Every `/api` request requires `Authorization: Bearer <Firebase ID token>`. Middleware runs Firebase Admin `verifyIdToken(token, true)` and loads the role from MongoDB by verified UID. Client roles/actor IDs cannot grant permissions. Teachers are checked against the actual enrollment/offering/cohort; mentors see assigned mentees; configured HOD and Office ownership constrain requests; Library/Accounts receive assigned queues. Students cannot edit roles/profiles/enrollments or another student's academics. Rejections require reasons and notify only the request owner. The exact Stage 1 → Mentor → HOD → Office workflow is preserved; Physics/Chemistry labs remain excluded.

Frontend helpers centralize token acquisition, HTTPS API calls, consistent errors and date conversion. The compatibility data helper uses authenticated HTTP polling for existing subscriptions; it has no direct database connection. Firebase dependencies remaining: frontend Auth SDK, Firebase Hosting/CLI, backend Firebase Admin **Auth**. Firestore Admin appears only in the guarded export script; old code is archived.

## Deployment preparation — do not run until ready to deploy

1. Create an Atlas Free cluster (formerly M0), a database user scoped to the intended database, and configure Atlas network access for the Render service's outbound IP ranges. Get its `mongodb+srv://.../<database>?retryWrites=true&w=majority` URI. Atlas is a replica set; do not substitute a standalone MongoDB server. Local emulator UID data belongs to the demo Auth project: it cannot authenticate against production Firebase without those identities existing there. Production must use its existing real Firebase Auth UIDs and separately authorized real-data migration, or normal provisioning into an empty production database. This implementation has not read production data.
2. In the existing production Firebase project `digital-no-due-shayan`, enable Email/Password Auth and download a service-account credential securely. Retain existing Auth users. Obtain the project's public Web API key from its web-app configuration. Do not commit service-account files or private keys.
3. Create a Render **Node Web Service**, root directory `server`, build `npm ci`, start `npm start`, health path `/health`, Free plan. `render.yaml` supplies these settings. Render sets `PORT` automatically. Set environment variables:

   ```text
   NODE_ENV=production
   MONGODB_URI=<Atlas URI with your production database name>
   FIREBASE_PROJECT_ID=digital-no-due-shayan
   FIREBASE_CLIENT_EMAIL=<service-account client_email>
   FIREBASE_PRIVATE_KEY=<service-account private_key, actual multiline PEM or escaped \n>
   FIREBASE_WEB_API_KEY=<Firebase public web API key>
   FRONTEND_ORIGIN=https://digital-no-due-shayan.web.app,https://digital-no-due-shayan.firebaseapp.com
   ```

   Do **not** set `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST` or source migration variables on Render. Add a custom frontend origin explicitly if used. Production accounts receive Firebase password-reset activation emails over HTTPS; no demo password is used. SMTP is optional for hosts that support it, but Render Free blocks outbound SMTP ports, so use the Firebase HTTPS email path there.
4. For an empty production MongoDB database, bind the first admin to an **existing** production Firebase Auth UID. On a trusted local machine, create ignored `server/.env.production` with the same Atlas/Firebase credentials (no emulator variables), then:

   ```powershell
   cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form\server"
   node --env-file=.env.production scripts/bootstrap-admin.mjs YOUR_EXISTING_FIREBASE_AUTH_UID
   ```

   This verifies that Auth user exists, creates only its missing MongoDB admin profile, and refuses to overwrite/promote an existing non-admin profile. It does not change Auth passwords. Existing migrated admin profiles need no bootstrap.
5. Once Render is deployed, check `https://YOUR-SERVICE.onrender.com/health`. Configure the public frontend API URL:

   ```powershell
   cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form"
   node server/scripts/configure-frontend.mjs https://YOUR-SERVICE.onrender.com
   node tests/node_modules/firebase-tools/lib/bin/firebase.js login
   node tests/node_modules/firebase-tools/lib/bin/firebase.js deploy --only hosting --project digital-no-due-shayan
   ```

   These commands are deployment instructions only; they were **not run**. No Firestore/Functions deployment is included. `js/api-config.js` contains only a public URL. To restore localhost afterward: `node server/scripts/configure-frontend.mjs http://127.0.0.1:3000`.
6. Log in as the production admin, configure institution domains/workflow owners, and use the existing normal teacher, offering and student provisioning flows. Verify production email activation, CORS and all roles after deployment. The local tests verify the production provisioning branch with an isolated email sender, not actual production email delivery. Actual Atlas/Render networking and credentials remain unverified until deployment.

Render Free services spin down after inactivity and may take roughly a minute to wake. Atlas Free has limited storage/throughput. These are deployment limitations, not local test failures. See [Render Express](https://render.com/docs/deploy-node-express-app), [Render Free](https://render.com/docs/free), [Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), [Firebase Auth REST](https://firebase.google.com/docs/reference/rest/auth) and [Firebase Hosting](https://firebase.google.com/docs/hosting/quickstart).

## Verification and changed files

20 isolated integration tests passed: token verification/spoofing, all three CSV imports through real Chrome preview/confirm, A/B/C mapping and backfill, exact teachers and independent marks, marks preservation on reimport, mentor ownership, rejection/reason/owner notification/resubmission, concurrent Stage 1 decisions, Mentor/HOD/Office issuance, issuance history, Office name/USN/email/duplicates/counts/filter/status, role denials, explicit resource routes, production activation without stored passwords, Firebase forgot/change password, and Mongo operator injection. Chrome exercised the full workflow, exact updated marks displayed to the student, mentor mentee academics and mobile layouts (1366/768/390); current Office search also passed 1920/1366/768/390 with the original Firestore snapshot unchanged. Browser requests were checked against accidental Firestore/Functions traffic. Backend production dependency audit: zero vulnerabilities at verification time.

Read-only Chrome checks against current migrated data also verified Zoya/A/Rohan/B/Ayesha/C subject counts match existing enrollments (2/4/4), and the five named teachers' assigned rosters contain 24/22/23 students in A/B/C respectively, with no cross-section display. These checks did not alter marks, enrollments, requests, approvals, notifications or hall-ticket records. Reproduce with `cd server; node scripts/verify-current.mjs` while local services are running. Results are ignored in `server/test/current-browser-results.json`.

Added: `server/` backend, models, middleware, resource/data routes, ported domain services, local Mongo/migration/test/config/bootstrap scripts, env example, dependency lock and isolated tests; `js/api.js`, `api-store.js`, `api-callable.js`, `api-config.js`; `render.yaml`; this guide; `legacy-firestore/` rollback copy.

Changed: `README.md`, `.gitignore`, `firebase.json`, `tests/package.json`; frontend modules `firebase-config.js`, `workflow.js`, `academic.js`, `academic-page.js`, `admin-data.js`, `admin.js`, `approver.js`, `auth.js`, `hod.js`, `institutional-admin.js`, `mentor.js`, `office.js`, `student-directory.js`, `student-updates.js`, `student.js` to use API adapters instead of Firestore/Functions. Active HTML/CSS and the visual design were not changed.

