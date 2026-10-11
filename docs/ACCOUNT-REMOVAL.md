# Account removal and rejection editor repair

The extended Student / Faculty Exit Management workflow, current verification and changed files are documented in [EXIT-MANAGEMENT.md](EXIT-MANAGEMENT.md). The rejection repair history below is retained.

Admin → Find institutional account → search an exact email, USN or employee ID → Delete account.

The review dialog shows the identity, department, student cohort or teacher offerings, current status and any removal blockers. Type `DELETE` and choose **Confirm removal**. No student or teacher dashboard has removal controls.

## Strategy

This is soft deletion (`accountStatus: inactive`), not a purge. User and student identity records remain so historical references keep their UID, name and identifiers. Unique identity reservations also remain.

- Student: disable Firebase Auth and revoke refresh tokens; deactivate current enrollments and clearance plan; clear current subject/teacher mappings; remove the derived Office search entry; archive unread notifications; cancel unfinished requests and pending approval projections with the prior status and actor/time retained. Marks, completed requests, completed approvals and hall tickets are retained.
- Teacher: block removal while active offerings, active enrollment mappings, pending approval duties or active mentees still depend on the account. Reassign offerings and refresh their student mappings, resolve/reassign pending requests, and reassign mentees first. Historical offerings, marks and approvals keep their references to the retained teacher identity.
- Auth failure: institutional access closes first with `deactivating`. If Firebase disable fails, the UI reports that a retry is required. Retrying completes the disable/revoke operation and finalizes `inactive`; normal app access stays blocked in the meantime.

The server verifies the authenticated institutional admin role. Frontend role values are ignored. Generic record editing cannot change removal metadata or overwrite an inactive profile. Transactions guard against concurrent mapping/import operations resurrecting active relationships.

## Re-import

CSV import **does not reactivate** inactive accounts and does not create replacement identities. Preview/import reports an inactive/disabled-account error. Reactivation is a separate explicit administrative decision through **Reactivate existing account**. Type `REACTIVATE` after reviewing the retained identity. The original Auth UID and password are preserved; student mappings are rebuilt using the normal provisioning mapper. Cancelled requests and archived notifications stay archived. Do not work around deactivation with a new UID or by clearing status fields.

Normal active account lists, teacher selection, rosters, matching and Office search exclude inactive profiles. The exact admin account lookup still finds the retained record and labels its inactive status for audit/retry purposes.

## Rejection editor

Successful polling refreshes already deferred list rendering while the editor was open. The remaining approver/HOD error callbacks replaced the entire content area after a failed polling request, bypassing that guard. The live frontend reproduction used a browser-only pending row and a failed poll; no real request was submitted. The old textarea was detached.

The error path now preserves the mounted editor and shows an inline refresh warning. Draft keys include request, approval/stage and approver UID. Keystrokes remain local; only Confirm Reject saves a reason. Cancel does not submit. The regression injects a polling failure while slowly typing the full reason, then verifies submission, the student-visible reason and resubmission for faculty, Library, Accounts, Mentor and HOD.

All destructive browser tests use disposable identities in the isolated audit Auth/API/MongoDB environment. No main demo account is removed by these tests.

## Verification and changed files

`npm test`: **37 passed, 0 failed, 0 skipped**. Google Chrome exercised rejection typing across a failed poll, cancellation, submission/student visibility/resubmission for all five roles; student deactivation and blocked login; Office/teacher active UI exclusion; assigned-teacher blocking; and unassigned-teacher deactivation. API tests cover role spoofing, typed confirmation, retained history, repeated removal/import, interrupted Auth disable and concurrent offering assignment/removal. Existing password reminder, CSV, marks, layout and complete approval workflow tests also pass.

The current main runtime had only issued requests when inspected. Its editor reproduction therefore used a browser-only pending fixture; real request submissions and destructive removal tests ran in the isolated audit environment. Main records were compared document-for-document before and after reloading only Express: users, students, marks, enrollments, offerings, requests, approvals, notifications and hall tickets were unchanged. Auth, Hosting and MongoDB were not restarted or reset.

Changed files for rejection:

- `js/rejection-editor.js`
- `js/approver.js`
- `js/mentor.js`
- `js/hod.js`

Changed files for removal and its inactive-account integration:

- `js/account-removal.js` (new)
- `js/institutional-admin.js`
- `server/src/services/account-removal.js` (new)
- `server/src/app.js`
- `server/src/middleware/auth.js`
- `server/src/services/authentication.js`
- `server/src/services/authorization.js`
- `server/src/services/document-store.js`
- `server/src/services/clearance.js`
- `server/src/services/office-search.js`
- `server/src/services/provisioning.js`
- `server/src/services/requests.js`
- `server/src/routes/data.js`
- `server/test/migration.test.mjs`
- This document
