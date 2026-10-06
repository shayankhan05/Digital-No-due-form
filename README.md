# Digital No-Due Form

Existing HTML/CSS/vanilla JavaScript ES-module project extended with centrally managed academic profiles, classes, marks and assignments. Firebase Authentication, Firestore and Hosting remain the backend. The frontend has **no npm installation or build step**. Optional npm dependencies under `tests/` are exclusively for local emulators and automated tests.

The college provisioning extension adds an admin-only callable Cloud Function, account creation without copied UIDs, validated bulk student/offering imports, automatic enrollment, activation email, Forgot Password and Change Password. Normal Admin is now the provisioning UI; raw-record/legacy controls remain in **Advanced record editing & legacy compatibility**. Server dependencies are installed separately under `functions/`.

Start with [the provisioning and professor-demo guide](docs/PROVISIONING.md), [exact extension file inventory](docs/PROVISIONING-CHANGES.md), and [pre-change audit](docs/PROVISIONING-AUDIT.md). Confirmed ISE 2022 Semester 5 C source rows are in `templates/ise-5c-2022-confirmed.csv`; unresolved faculty/codes/assessments remain blank and cannot be imported. The original synthetic fixture is separate.

## Roles and pages

| Role | Features |
| --- | --- |
| Student | Dashboard, read-only profile/mentor/subjects/marks/assignments, automatic No-Due request, approval tracker, rejection reasons, resubmission, private notifications |
| Subject faculty | Existing approval desk; `academic.html` shows profile, assigned subject/semester/section classes, paginated students, configurable assessment marks and assignments |
| Mentor | Existing mentor approval desk; paginated mentee directory, full mentee academic/clearance details; independently assigned teaching classes can edit their own marks |
| Admin | Linked accounts/student profiles, staff/mentors, subjects, class/teacher mappings, enrollments, assignments, workflow configuration, reviewed CSV import, clearance-plan preparation and explicit legacy-request upgrade; academic page can correct marks |
| HOD | Assigned requests at `pending_hod`; approval/rejection with mandatory reason |
| Office | Assigned cleared requests, exact-USN lookup and final issuance |
| Library/labs/accounts | Existing Stage 1 approval desk with explicit assigned account UIDs |

`student-dashboard.html#profile` retains the existing profile-photo controls. Photos are local to the browser and scoped to the signed-in UID. `academic.html` is the shared academic view; `academic.html?student=AUTH_UID` opens an authorized mentee. Mentors can use “My teaching classes & marks” for their independently assigned subjects.

## Initial setup and account linking

1. Use the existing Firebase project and web configuration in `js/firebase-config.js`. Enable Email/Password Authentication and Firestore. Use restrictive rules rather than test mode.
2. Create the first administrator in **Firebase Console → Authentication → Users → Add user**. Copy the actual Authentication UID.
3. In Firestore Console create `users/THAT_UID` with `role: "admin"`, `name`, `email`, `phone`, `facultyId` and `department`. This one bootstrap requires privileged Console access; signing in does not grant admin access automatically.
4. Deploy the rules and indexes using the commands below. Log in to `login.html` with the administrator's email/password.
5. Configure **Institution policy**, then use **Provision college account** or the validated CSV importer. The callable backend creates Auth users and links UIDs automatically. Production activation uses configured SMTP and Secret Manager. **Staff & accounts** remains under Advanced editing for explicit existing-UID linking.
6. Use role `mentor` for mentors. A mentor can also teach when explicitly assigned to a class; that never grants permission to edit other subjects. Teachers use `subject_faculty`. Create the HOD, office, library, physics lab, chemistry lab and accounts profiles too.
7. Use Admin → **Students** to link each actual student Auth UID to name, USN, email, phone, numeric semester, section and the mentor's Auth UID. Student records are `students/{authUid}`; a USN is not an Auth UID. Editing a student invalidates their prepared clearance plan until refreshed.

### Subjects, sections and marks

1. **Subjects**: choose a stable ID, subject name and code, e.g. ID `dbms`, code `DBMS`.
2. **Classes & teachers**: choose an offering ID such as `dbms-6-C`; provide subject ID, semester `6`, section `C`, and teacher Auth UID. One offering represents one subject/semester/section and one assigned teacher.
3. Enter assessment components one per line as `id, label, maximum`, for example:

   ```text
   ia1, Internal Assessment 1, 30
   ia2, Internal Assessment 2, 30
   assignment, Assignment, 10
   ```

   Supports 1–10 configurable components; IDs are stable letters/numbers/underscore/hyphen. Existing mark values should be reviewed before changing component IDs or maxima.
4. **Workflow assignments**: save actual UIDs for the four service desks, HOD and office. The current institution has one configured HOD/office/service account per workflow; faculty and mentors vary by student/class.
5. **Student subjects**: enter student UID and offering ID. Semester and section must match the student profile. Enrolling prepares the student's plan when workflow configuration is complete. Deactivate outdated enrollments instead of deleting them.
6. Use **Refresh academic mappings & clearance plan** for each affected student after changing a mentor, teaching assignment, class or enrollment. Editing a class invalidates only its enrolled students' plans and removes the prior teacher's derived scope until refreshed. Changed workflow desk UIDs also require fresh plans. Preparation derives teacher/subject mappings from active enrollments and creates the trusted plan. A student can have 1–30 current subjects. If renaming a subject or changing its code, edit its affected offerings to refresh their display snapshots, then refresh the students' plans.
7. **Assignments**: save a stable assignment ID, offering ID, title, description, due date and optional informational status. These are class notices, not an LMS or file-submission system.
8. Teachers log in, open **Profile, My Students & Marks**, select a class, enter marks, and click **Save marks**. Blank components remain unentered. Rules enforce the current enrollment, teacher, subject, semester, section, component IDs and allowed mark range. Admins can correct marks through `academic.html`.

Advanced admin lists use 30-record pages and exact-ID lookup. The retained legacy UID-based CSV importer uses headers `uid,name,usn,email,phone,semester,section,mentorId`; quoted commas, escaped quotes and multiline CSV fields are supported. Preview before importing. Imports merge profiles, invalidate their plans and never infer UID from USN. They run sequentially and report progress; a failed row stops the import and earlier successful rows remain saved. Assign subjects and refresh plans afterward.

## Firestore schema

| Path | Purpose and principal fields |
| --- | --- |
| `users/{authUid}` | Auth-linked role and staff contact/profile fields; only admin may manage roles |
| `students/{authUid}` | Canonical student personal/academic profile: name, USN, email, phone, semester, section, mentorId; derived bounded teacherIds/offeringIds |
| `subjects/{subjectId}` | Stable subject identity, name, code |
| `offerings/{offeringId}` | subjectId, subjectCode/name, semester, section, teacherId, components and componentIds |
| `enrollments/{studentUid}__{offeringId}` | studentId, offeringId, teacherId, mentorId, semester, section, subjectId/code, active |
| `marks/{enrollmentId}` | studentId, offeringId, teacherId, mentorId, subjectId/code, semester/section, `scores: {componentId: number}`, updatedBy/updatedAt |
| `assignments/{assignmentId}` | offeringId, title, description, dueDate (ISO date), optional class-wide status |
| `settings/workflow` | Configured library/lab/accounts UIDs plus hodId and officeId |
| `students/{authUid}/clearance/plan` | Admin-derived approver items, initial pending states, assigned UIDs, semester/section/mentor, valid flag |
| `noDueRequests/{requestId}` | Existing fields/statuses plus schemaVersion 2, immutable approver/academic snapshot, approvalStates, resubmissionStates, remaining counter, version and lastEvent |
| `noDueRequests/{requestId}/approvals/{approvalId}` | Existing approval audit subcollection retained; current decisions mirror the authoritative request map |
| `users/{studentUid}/notifications/{requestId}_{version}` | Immutable event: owning student/request ID, actor UID/name/type, subject code, reason, status, timestamp/version |

Teacher/mentor profiles reuse `users`; no duplicate teachers collection is necessary. Offerings and enrollments hold stable references, with selected display/scope fields maintained by admin to support indexed queries. Request snapshots preserve historical assignments. A current-class reassignment changes marks permissions immediately; refresh affected profiles/enrollments/plans before using academic screens. Existing request assignees remain responsible for that request unless an administrator explicitly corrects the historical assignment.

## Workflow and security

```text
pending_stage1 → pending_mentor → pending_hod → cleared → issued
      any approval rejection → rejected → resubmit at rejected stage
```

Required subject approvers come from the student's admin-prepared enrollments; students never select academic values or approvers. Four required service approvals run in parallel with subjects. The request stores a bounded approval-state map and remaining counter. Each decision, counter/stage update, audit projection and private notification commits in one transaction. Firestore rules verify the specific assigned approver, changed fields, counter change, and notification via `getAfter`; there is no independent client stage-advance operation. Rejection requires a nonblank reason. Resubmission resets rejected decisions and preserves approved items. Mentor/HOD rejection resumes that stage.

Students cannot modify profiles, roles or marks. Teachers can write marks only for their current active offering/enrollment and matching student semester/section. A mentor can read assigned mentees' marks and can edit only independently assigned teaching subjects. Notifications can only be read by their owning student or admin. Records are not deleted from the client. Admin is a trusted institutional manager with correction access; safeguard admin credentials.

Indexes are committed in `firestore.indexes.json` and referenced by `firebase.json`. Queries use authenticated IDs, offering IDs and mentor IDs with limits. Approval listeners are detached on page unload. The faculty queue has a load-more control; mentor/HOD/office desks show up to 30 actionable requests and replenish as requests are processed. Use the academic mentee directory for pagination beyond the mentor dashboard's first 30.

## Existing data and migration

No production data is automatically modified. Existing request fields, approval documents and statuses remain. Older requests can still be read by their owner/assigned mentor; full new staff authorization requires the explicit compatibility upgrade.

1. Back up existing data before administrative corrections.
2. Link legacy student records to their real Authentication UIDs using Admin → Students, keeping old USN-keyed records for reference. Populate subjects/offerings/enrollments and prepare a clearance plan. Nothing automatically deletes old records or copies guessed identities.
3. In **Legacy request compatibility**, enter an existing request ID. Review the student, status and current mappings in the confirmation. The helper matches old approver types/subject codes, preserves existing approval document IDs, statuses and reasons, and adds verified UID assignments/state counters. Unmatched mappings abort; correct them first.
4. Old requests with multiple rejected items are supported. Their next resubmission resets all rejected items together. Legacy rejection reasons remain in their existing approval records; new notifications begin with the next action (old events are not fabricated).

## Run locally

For the existing configured Firebase project, serve the repository with VS Code Live Server or:

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form"
python -m http.server 5500 --bind 127.0.0.1
```

Open `http://127.0.0.1:5500/login.html`. This mode uses your configured live Firebase project. Never open HTML by double-clicking; ES modules require HTTP.

### Safe local demo and tests

Install Node.js and Java 21 or newer for Firebase emulators. The verified environment used Node 24 and Java 26. In one PowerShell terminal:

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form\tests"
npm ci
npm run preview
```

Install server dependencies first with `npm ci` from the project's `functions/` folder. The expanded preview includes Functions on 5001 and exports/imports state at `local-emulator-backup/current`. Prefer `npm run audit` for all 26 extension tests on isolated ports/project, keeping the browser demo untouched. `npm run seed:bulk` provisions 50 synthetic ISE students across A/B/C with separate synthetic offerings. See the provisioning guide for exact credentials and production steps.

In another terminal in `tests/`:

```powershell
npm test
npm run seed
```

`npm test` clears **only the demo Firestore emulator** and seeds isolated fixtures. Run tests before seeding your browser demo. `npm run seed` creates or reuses demo-only accounts and populates two Semester 5 Section C students, three separately taught subjects, marks, assignments and complete approval mappings. Reseeding resets known demo academic fixtures and preserves request/notification history. Run `npm run verify:demo` to check all logins, academic records, teacher updates and notification privacy. The expanded preview exports/imports state on normal shutdown/restart; forced termination can lose changes since the last export. Stop them with Ctrl+C; if Windows leaves Java holding 8180, verify that the process command identifies this project's demo Firestore emulator before stopping that specific process.

Open `http://127.0.0.1:5050/login.html?emulator=1`. Demo account emails are `student@demo.test`, `subject_faculty@demo.test`, `mentor@demo.test`, `admin@demo.test`, `hod@demo.test`, `office@demo.test`, and the four service roles at `@demo.test`. All demo passwords: `DemoPassword123!`. These accounts only exist locally. Emulator UI is `http://127.0.0.1:4500`.

The browser retains emulator mode for that localhost tab's session. Local port 5050 always selects the demo emulators, including fresh tabs, and uses a dummy API key. Hosted production always uses the existing Firebase web configuration; the emulator switch only works on localhost/127.0.0.1. See [the complete local demo walkthrough](docs/LOCAL-DEMO.md) for every credential, seeded record and rejection/resubmission/issuance step.

Alternatively, with no emulators already running:

```powershell
cd tests
npm run emulators
```

This starts Auth/Firestore, runs the suite, and shuts the CLI down. Test dependencies are not deployed by Hosting. Expected permission-denied logs are assertions proving unauthorized actions fail.

See [validation report](docs/VALIDATION.md) for scenario coverage and limits. The emulator does not enforce production composite-index availability; deploy the committed indexes and wait for them to build.

## Deploy to the existing Firebase project

Use a Firebase Console account authorized for your existing project. Do not create another production project.

Provisioning deployment also requires the institutional Functions codebase, `SMTP_PASSWORD` secret and actual institution email policy. Follow the complete production sequence in [PROVISIONING.md](docs/PROVISIONING.md) before using the new account/import dashboard on the live project.

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form\tests"
npx firebase login
npx firebase projects:list
npx firebase deploy --project digital-no-due-shayan --config ../firebase.json --only firestore:rules,firestore:indexes
npx firebase deploy --project digital-no-due-shayan --config ../firebase.json --only hosting
```

Replace the project ID only if your existing project differs from `js/firebase-config.js`. Prepare/link production records using Console/bootstrap and the admin page; the local demo seed must never be repurposed as a production import. Rules and indexes must be deployed alongside the app before using the new features. Hosting ignores tests, docs, caches, logs and rules files.

## Handover

- [Audit and implementation decisions](docs/AUDIT.md)
- [Exact created/modified file list](docs/CHANGES.md)
- [Validation and scenario checklist](docs/VALIDATION.md)

Limitations: Custom activation delivery requires institution SMTP and server Secret Manager configuration; one institution-level service/HOD/office workflow configuration; assignments have informational class-wide status, no per-student submission tracking; notifications show the latest 30 events and can be refreshed; current student academic views show up to 30 active subjects and the latest 50 assignments per subject. No production deployment, live-data migration or live-account validation is performed automatically. The manifest's icon paths already lacked corresponding files in the repository; app installation artwork remains a separate asset task.
