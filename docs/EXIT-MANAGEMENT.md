# Student / Faculty Exit Management

Open the existing Admin dashboard at `http://127.0.0.1:5050/admin-dashboard.html`. The new exit-management controls extend **Find institutional account → Delete account** and use its existing `/api/admin/account-removal` endpoint. No second deletion implementation was introduced.

## Lookup and review

- **Remove / Deactivate Faculty** accepts employee ID or college email, case-insensitively. The review shows name, identifier, email, phone, department, role, account status and active offerings, including subject/code, semester, section, scheme and active enrollment counts. Faculty/employee roles include subject faculty, mentor, HOD, Office and service staff; admin accounts cannot be removed.
- **Remove / Deactivate Student** accepts USN or college email, case-insensitively. The review shows identity, contact details, department, scheme/cohort, mentor name/email, subjects and assigned teachers, latest active No-Due status (or latest historical request), and hall-ticket count. Admission date is displayed only when stored; otherwise it says **Not available**. No dates were fabricated.
- Ambiguous identities are rejected rather than choosing a UID arbitrarily.
- Both the original Find account action and the dedicated searches use the same full review/confirmation dialog. The admin must type exact uppercase **DELETE** before **Confirm removal** is enabled; the server independently enforces this.

## Dependency protection and deactivation

Faculty removal is blocked while any active offerings, active teacher enrollment mappings, outstanding approval duties, active mentees or configured workflow responsibilities refer to that employee. Affected classes are displayed. Reassign classes using the existing advanced editor, refresh the affected student mappings through the existing provisioning flow, and resolve/reassign pending duties before retrying. Historical marks and completed approval attribution remain attached to the retained faculty identity.

Student removal keeps the original user/student records and identifiers, marks them inactive, deactivates enrollments, clears current teacher/offering lists, invalidates the clearance plan, removes the derived active Office search entry, cancels unfinished requests/pending approval projections, and archives unread notifications. Completed requests, completed approval projections, marks and hall-ticket history are retained.

The existing Auth strategy is preserved: disable the Firebase user and revoke refresh tokens. Mongo access is blocked before contacting Firebase. If Auth disable fails, the account stays blocked and the existing removal action can be retried. A completed removal returns idempotently without issuing another disable that could interfere with a subsequent explicit reactivation.

The new `accountExitEvents` collection records deactivation/reactivation actor, identity UID and time. Existing historical records are not purged.

## Directory and CSV exports

The admin-only directory provides **Students / Faculty-Employees** and **Active / Inactive / All** filters, with 50-row pagination. It shows names, USNs/employee IDs, department, cohort or role/assigned subjects, and status. Details and explicit reactivation are available from retained inactive identities.

**Export Active Students CSV** and **Export Active Faculty CSV** exclude inactive, deleted and deactivating accounts. **Export filtered directory CSV** supports former-account/history exports using the selected filter. CSV cells are quoted and protected against formula injection. Department labels use **Information Science & Engineering** for internal ISE values; other departments are preserved. Exports are bounded to 10,000 accounts with an explicit error if exceeded.

Marks-roster export additionally excludes inactive student profiles. Original uploaded/source CSV files are never rewritten.

## Re-import and explicit reactivation

Student/teacher import checks inactive identities by email and USN/employee ID, including case-insensitive matches. Preview reports **This identity already exists but is inactive** and offers **Reactivate existing account**. Invalid/inactive rows cannot silently create replacement identities or reactivate an account through import.

Reactivation requires a separate full identity review and typing **REACTIVATE**. The server checks the retained profile, Auth UID/email and conflicting institutional identifiers. It preserves the UID and existing password; it does not create a replacement Auth user or store a password.

Student mappings are rebuilt using the existing provisioning mapper against current matching active offerings. Student status, current enrollments, clearance plan and derived Office search entry commit in one Mongo transaction. Historical marks remain unchanged, repeated imports remain idempotent, and cancelled requests/archived notifications remain archived. Reactivation is blocked if current mentor/teacher/workflow dependencies are unavailable or inactive. If Auth or mapping fails, institutional access remains blocked and a retry can finish the operation.

All operations are authenticated by Firebase and recheck the actual stored administrator role server-side; frontend role values are ignored. Generic record editing cannot change exit/reactivation state fields.

## Verification

- Full `npm test`: **55 passed, 0 failed** in isolated audit Auth/MongoDB, including installed Chrome.
- Final focused regression after the completed-removal safeguard: **7 passed, 0 failed**, including the full Chrome exit/reactivation workflows and injected Auth/mapping failure recovery.
- `node --test tests/workflow.test.mjs`: **5 passed, 0 failed**.
- Disposable faculty: employee-ID/email review, active-class blocking, explicit reassignment and normal cohort mapping, safe deactivation, blocked login, active-list/export exclusion, preserved marks/completed approval attribution, and explicit reactivation with the original UID/password.
- Disposable student: USN/full identity/mentor/subjects review, typed DELETE, safe deactivation, blocked login, removed active mappings/Office/mentee visibility, cancelled pending requests, archived notifications, retained marks/issued requests/approved projections/hall tickets, CSV inactive-identity detection, explicit reactivation, restored same-section mappings and original-password login, and idempotent re-import.
- Non-admin lookup/directory/export/removal/reactivation requests, including spoofed frontend roles, were denied.
- Current demo Chrome checks were read-only: Sana Mir / FAC204 / BCS514 correctly blocked removal; Ayesha / 1AY24IS158 displayed complete details; active downloads contained **84 students** and **136 faculty/employees**. The existing password reminder was dismissed normally before interacting with exports.
- Current exit UI was checked at **1366, 768 and 390px** without horizontal page overflow; desktop/mobile viewport screenshots were visually reviewed.
- Every pre-existing current-demo collection matched the saved pre-change snapshot. The new audit collection was empty; **zero real accounts were deactivated**. MongoDB and Auth/hosting emulators were not reset. Only the API was restarted to load the code. No deployment or push occurred.

Ignored verification artifacts are under `server/test/browser-artifacts/exit-*`.

## Exact files changed for this request

- `js/account-removal.js` — extends the existing review/confirmation flow; dedicated searches, directory, exports and explicit reactivation.
- `js/institutional-admin.js` — mounts the exit controls and offers reactivation from inactive CSV preview rows.
- `css/style.css` — scoped exit grid, dialog scrolling and safe wrapping only; existing theme/card/button styling retained.
- `server/src/services/account-removal.js` — enriched preview, lookup/directory/export actions, dependency protection, audit events and safe reactivation on the same endpoint.
- `server/src/services/provisioning.js` — inactive identity detection and reuse of normal student mapping for explicit reactivation.
- `server/src/services/marks-csv.js` — excludes inactive student profiles from active marks rosters.
- `server/src/app.js` — connects the existing endpoint to the extended service and normal mapper.
- `server/src/models/index.js` — exit audit collection/index.
- `server/src/routes/data.js` — protects exit/reactivation metadata from generic record writes.
- `server/test/migration.test.mjs` — isolated exit/reactivation regressions and scoped legacy search selectors.
- `docs/ACCOUNT-REMOVAL.md` — updates reactivation guidance and links this extension report.
- `docs/EXIT-MANAGEMENT.md` — this report.

No unrelated authentication, password reminder, workflow transitions, rejection/resubmission, marks calculation, routing or theme implementation was changed.
