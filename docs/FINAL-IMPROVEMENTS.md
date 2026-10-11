# Final improvement pass — local verification

Active architecture: root HTML/CSS/JavaScript + Express/MongoDB + Firebase Authentication/Hosting. `legacy-firestore/` remains untouched. Nothing was deployed or pushed.

## Login repair and preservation

The live Auth emulator had zero users while MongoDB retained institutional profiles; an older Firebase process also served the Firestore frontend. Missing Auth identities were restored from the saved emulator export without changing UIDs or hashes. The root startup script now selects the correct frontend/config explicitly.

`npm run local` and `npm run seed` are the supported root commands. See README for exact PowerShell commands and the Chrome-tested demo account table. A repeated seed restored zero accounts and inserted zero application records.

Protected main-data snapshots were compared document-for-document, not just by count: 14 marks, 560 enrollments, 23 offerings, 9 requests, 53 approval records and 8 hall-ticket records. Main Chrome checks were read-only; all CSV mutations, password changes and new requests used the isolated audit runtime.

## Implementation and security

- Marks CSV export uses exact assigned offering/enrollment/cohort and actual assessment configuration. Preview reports mapping, identity, duplicate-USN, numeric and maximum errors. Import requires explicit confirmation and revalidates server-side, merges only supplied values in transactions and uses existing enrollment/marks IDs. Teacher overview lists the full roster; students use the existing academic view.
- Approval IDs are deterministic per request/offering. A normalized subject-code/teacher/department/scheme/semester/section identity also removes equivalent duplicate offerings from a plan. Two distinct subject codes remain two clearly labelled items. No historical data was deleted to achieve this.
- Active request statuses include Stage 1, Mentor, HOD, Office, cleared and rejected awaiting resubmission. MongoDB transactions contend on a per-student revision, so concurrent creates retry and observe the winner. A stable browser submission key reuses the same deterministic request ID. Issued requests are terminal. Identical approval/issuance retries do not create additional events or hall tickets.
- Newly default-password-provisioned accounts receive `mustChangePassword`. The API blocks normal use until Firebase verifies a later password update; the UI redirects persistently and allows logout. Firebase updates/reset APIs handle passwords. The later [three-issue fix](THREE-ISSUES-FIX.md) also repairs missing flags on eligible restored demo profiles without resetting credentials. Application records contain neither old nor new passwords.
- Email/USN/employee ID is resolved on the server with case-insensitive lookup, ambiguity rejection and cross-identity collision prevention. Firebase verifies the supplied password before the resolved email is returned. Login attempts are bounded per IP; errors for unknown IDs/wrong passwords are identical.
- Password-eye controls are native non-submit buttons with Show/Hide labels and `aria-pressed`; input values remain unchanged. Login, password change and custom reset/activation password fields share them.
- Firebase UID and MongoDB role drive authorization. Teacher imports require ownership, active exact enrollment and cohort; Office/Library/Accounts cannot edit marks. Password-state fields cannot be changed by generic admin edits. Service-role profile access is restricted to its responsibility.

## Layout

The original pass retained narrow shells. The subsequent [three-issue fix](THREE-ISSUES-FIX.md) supersedes that decision: authenticated shells now expand to 1800px; the login card stays compact. Added selectors from this earlier pass: `.password-field`, `.password-field input`, `.password-toggle`, `.password-toggle:focus-visible`, `.main-content`, `.marks-tools`, `.marks-tools > *`, `.marks-csv-card input[type=checkbox]`, `.marks-csv-card .table-scroll`, `.marks-csv-card details`, and their narrow-screen overrides. Shared dynamic-table wrapping adds `.table-scroll` containers without replacing table structure. No theme palette, fonts or card redesign.

Chrome acceptance covers widths 1920, 1366, 1024, 768 and 390. Main restored-role login/overflow checks and isolated feature/regression checks are separate. Screenshots/results are local gitignored files in `server/test/browser-artifacts/`.

## Final results (2026-10-10)

`npm test`: **31 passed, 0 failed, 0 skipped**. Installed Google Chrome 154 ran headlessly through actual login, provisioning CSV preview/confirmation, marks CSV download/edit/upload/confirmation, password-change and forgot/reset forms, academic/student/teacher views, Office search, and Student → exact teachers/Library/Accounts → Mentor → HOD → Office → Hall Ticket Issued. Tests also cover rejection reasons/owner-only notifications/resubmission, simultaneous request creation, repeated imports, approval/issuance retries, concurrent identifier collisions and all five viewport widths (including populated CSV previews).

After restarting the active runtime with the saved Auth export, the read-only main acceptance script verified all eight demo roles plus imported Ayesha/Sana and USN/employee-ID login. Repeated seed: **0 restored Auth, 103 unchanged Auth, 0 inserted application records**. Protected main-data snapshots still match. No test requests or marks were written into the main demo database. No application failure remains in the tested flows.

## Files

- Layout/UI: `css/style.css`, `login.html`, `reset-password.html`, `js/password-visibility.js`, `js/responsive-layout.js`, `js/reset-password.js`.
- Active frontend integration: `js/api.js`, `js/auth.js`, `js/password-settings.js`, `js/academic-page.js`, `js/marks-csv.js`, `js/create-request.js`, `js/workflow.js`.
- API: `server/src/app.js`, `server/src/server.js`, `server/src/models/index.js`, `server/src/routes/data.js`, `server/src/routes/marks-csv.js`, `server/src/services/authentication.js`, `server/src/services/authorization.js`, `server/src/services/marks-csv.js`, `server/src/services/provisioning.js`, `server/src/services/clearance.js`, `server/src/services/requests.js`.
- Startup/testing/docs: root `package.json`, `tests/package.json`, `server/scripts/local.mjs`, `server/scripts/local-mongo.mjs`, `server/scripts/seed-local.mjs`, `server/scripts/verify-current-local.mjs`, `server/test/migration.test.mjs`, `.gitignore`, `README.md`, this report.

## Operational limits

Exact existing demo identities depend on saved gitignored Auth/migration backups; these are not bundled into source control. Stop local development normally with Ctrl+C to save subsequent Auth/password changes. Production email delivery/Firebase action-URL configuration, public deployment, distributed login rate limiting and production load testing are outside this local pass. The local IP limiter is in-process. Main historical fixtures were preserved rather than silently removed.
