# Files changed in this update

This inventory compares the final files with the working tree as received, not just Git HEAD. Several admin/theme/dashboard files were already untracked or modified when work began. No existing Firestore records were deleted or automatically migrated.

## Created

- `academic.html`
- `firestore.indexes.json`
- `js/ui.js`
- `js/academic.js`
- `js/academic-page.js`
- `js/admin-data.js`
- `js/csv.js`
- `js/student-updates.js`
- `js/workflow-model.js`
- `docs/AUDIT.md`
- `docs/CHANGES.md`
- `docs/VALIDATION.md`
- `docs/demo-rejection.png`
- `tests/package.json`
- `tests/package-lock.json`
- `tests/firebase-loader.mjs`
- `tests/runtime.mjs`
- `tests/workflow.test.mjs`
- `tests/security.test.mjs`
- `tests/seed-demo.mjs`

## Modified

- `.gitignore` (retains existing credential, dependency, editor and Firebase-cache exclusions)
- `README.md`
- `admin-dashboard.html` (already present as an untracked working-tree file)
- `approver-dashboard.html`
- `mentor-dashboard.html`
- `student-dashboard.html`
- `css/style.css`
- `firebase.json`
- `firestore.rules`
- `js/admin.js` (already present as an untracked working-tree file)
- `js/approver.js`
- `js/auth.js`
- `js/create-request.js`
- `js/firebase-config.js`
- `js/hod.js`
- `js/mentor.js`
- `js/office.js`
- `js/student.js`
- `js/workflow.js`

Existing `create-request.html`, `hod-dashboard.html`, `office-dashboard.html`, `login.html`, `manifest.json`, `js/theme.js` and the unused legacy `js/student-directory.js` were inspected and retained. Existing changes to those files may still appear in Git status because they predated this update. The old directory module is not loaded by a production page; the extended admin page provides its directory/CSV features with UID linking, pagination and proper CSV parsing.

Local ignored artifacts: emulator debug logs, Firebase cache, optional `tests/node_modules` and `tests/.npm-cache`. These are not source deliverables or Hosting assets.

Local-demo follow-up: updated `tests/seed-demo.mjs`, `tests/package.json`, `js/firebase-config.js` and `README.md`; added `tests/verify-demo.mjs` and `docs/LOCAL-DEMO.md`. The seed now supports repeatable Semester 5 Section C fixtures and all role logins. Dedicated local port 5050 always selects the demo project with a dummy key. Updated this inventory and `docs/VALIDATION.md` with verification results.

The subsequent college provisioning extension is listed precisely in [PROVISIONING-CHANGES.md](PROVISIONING-CHANGES.md). Its architecture, templates, credentials, professor walkthrough and deployment commands are in [PROVISIONING.md](PROVISIONING.md).
