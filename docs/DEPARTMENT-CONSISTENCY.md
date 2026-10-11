# Department consistency verification

The active project branch displays **Information Science & Engineering** and stores the stable code **ISE**. No deploy, push, database reset or Auth mutation was performed.

## Files changed for this request

- `js/department.js`: shared code, label and department-field normalization.
- `js/ui.js`: academic/profile department labels.
- `js/academic-page.js`: offering department display.
- `js/admin-data.js`: canonical matching in legacy academic mapping.
- `js/admin.js`: readable department in record editing.
- `js/institutional-admin.js`: policy labels, import guidance and preview labels.
- `js/approver.js`: faculty/Accounts profile department row; Library role wording preserved.
- `js/mentor.js`: mentor profile department row.
- `js/hod.js`: HOD profile department row.
- `js/office.js`: Office profile and search-result department labels.
- `js/account-removal.js`: readable department in account preview.
- `js/marks-csv.js`: selected offering department label.
- `server/src/services/provisioning.js`: canonical imports/policy values and explicit configured aliases.
- `server/src/services/clearance.js`: canonical department comparison.
- `server/src/services/office-search.js`: canonical department filtering.
- `server/src/services/marks-csv.js`: full-name export and canonical/legacy-alias import validation.
- `server/src/services/document-store.js`: normalize department metadata at the repository write boundary.
- `server/src/services/department-migration.js`: transactional, idempotent department-only migration.
- `server/scripts/migrate-demo-department.mjs`: loopback demo-only migration CLI, dry-run by default and backup before apply.
- `server/scripts/seed-local.mjs`: normalize restored demo department data through the same migration.
- `server/test/migration.test.mjs`: normalization, migration, CSV and Chrome regressions.
- `docs/DEPARTMENT-CONSISTENCY.md`: this report.

## Current local data migration

Changed 20 department fields across 18 existing documents:

| Collection | Documents | Department fields |
|---|---:|---:|
| users | 13 | 13 |
| students | 2 | 2 |
| officeStudentSearch | 2 | 2 |
| clearancePlans | 1 | 3 nested approval-item department fields |

Added `institutionPolicy/institution` with `departments: ["ISE"]` and the explicit demo compatibility alias `"computer science": "ISE"`. Existing policy documents were preserved. A repeated apply and a final dry-run both reported zero changes.

The global normalizer accepts ISE, Information Science, and the full branch name. **Computer Science is converted only with an explicit configured alias**, installed for this demo. CSE remains separate; its 15 fixture profiles were not relabeled. Offering/student identity keys continue to use ISE, preventing new identities or duplicate offering/enrollment records.

## Verification

- `npm test`: **51/51 passed**, using isolated audit Auth and MongoDB with installed Chrome.
- `node --test tests/workflow.test.mjs`: **5/5 passed**.
- Actual current local app at `http://127.0.0.1:5050`: installed Chrome verified Ayesha's student profile/dashboard and academic records; Vivek's faculty profile, offering roster and CSV tools; mentor; HOD; Accounts; admin policy; Office profile and Ayesha search with the full department-name filter.
- No checked branch display contained Computer Science. Screenshots and current-browser report are in ignored `server/test/browser-artifacts/department-*` artifacts.
- Vivek's BCS502 Section C export contained **23 students**, all with the full department label and Section C. Previewing the three scored rows produced **3 valid / 0 errors**. Existing scores remained Ayesha 27/18/10, Aditya 19/22/7, Sara 26/18/8.
- Isolated Chrome CSV teacher, offering and student imports used the full department name successfully. Additional regressions verified explicit legacy alias support, stable offering IDs, independent departments, repeat migration/import safety and marks preservation.

## Preservation

Compared every current collection against a pre-migration snapshot. Only the listed department changes and explicit policy addition occurred during migration. After browser verification, one normal student-dashboard clearance-cache `updatedAt` timestamp had refreshed; the cached plan contents were unchanged.

All UIDs, USNs, employee IDs, passwords/Auth identities, 41 marks records, 560 enrollments, offerings, 11 No-Due requests, approvals, notifications and hall-ticket history were preserved. No CSS/theme, routing, password, rejection, resubmission or issuance logic was changed for this request.

The API alone was restarted to load the changes. MongoDB and Auth/hosting emulators were not reset. The current session is ready to refresh and test.
