# Provisioning-extension file inventory

This follow-up has the changes below. Earlier uncommitted academic/workflow changes remain separately documented in CHANGES.md.

## Modified

`.gitignore`, `README.md`, `admin-dashboard.html`, `login.html`, `css/style.css`, `firebase.json`, `firestore.indexes.json`, `firestore.rules`, `js/auth.js`, `js/firebase-config.js`, `js/admin-data.js`, `js/admin.js`, `js/csv.js`, `js/ui.js`, `tests/package.json`, `tests/security.test.mjs`, `docs/CHANGES.md`, `docs/VALIDATION.md`, `docs/LOCAL-DEMO.md`.

## Created

- `functions/package.json`, `functions/package-lock.json`, `functions/index.js`, `functions/provisioning.js`.
- `advanced-admin.html`, `password-settings.html`, `js/institutional-admin.js`, `js/password-settings.js`.
- `firebase-audit.json`.
- `templates/student-import.csv`, `templates/offering-import.csv`, `templates/ise-5c-2022-confirmed.csv`, and matching `.csv.txt` download copies.
- Generated `templates/demo-students-50.csv`.
- `tests/start-preview.mjs`, `tests/run-audit-tests.mjs`, `tests/bulk-fixture.mjs`, `tests/provisioning.test.mjs`, `tests/seed-bulk.mjs`.
- `docs/PROVISIONING-AUDIT.md`, `docs/PROVISIONING.md`, `docs/PROVISIONING-CHANGES.md`.
- `docs/provisioning-browser.png` (browser provisioning success evidence).

Ignored local runtime artifacts: functions/node_modules, emulator logs, local-emulator-backup/current and tests/bulk-demo-results.json. No service-account credential file was created. Production was not deployed or migrated.
