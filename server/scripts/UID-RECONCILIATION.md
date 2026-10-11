# Production UID reconciliation

This maintenance tool is separate from the application, local seeding, and the
Firestore-to-Mongo migration. It never creates or deletes Firebase Auth users,
changes their passwords, updates Auth claims, or changes application login rules.

Run from `server`. Put the Atlas URI in a local file, either alone or as
`MONGODB_URI=...`. Keep the service-account JSON outside the repository.

```powershell
node scripts/reconcile-production-uids.mjs --uri-file=C:/path/atlas-uri.txt --key-file=C:/path/service-account.json
```

This is read-only against Atlas and Auth. It creates a timestamped directory under
the gitignored `server/migration-output/` with raw BSON collections, canonical
Extended JSON exports, collection options/index definitions, SHA-256 hashes, Auth
identity metadata (no password material), an audit, and the proposed change plan.
These exports contain institutional data; retain them privately.

The target must be Atlas database `digital_no_due`, Firebase project
`digital-no-due-shayan`, and no Auth emulator may be configured. If the system DNS
resolver refuses SRV queries, `--dns-server=1.1.1.1` changes only this Node process's
resolver; it does not change Windows or deployment settings.

Review every mapping and all unmatched identities before applying. Matching uses
unique normalized email/collegeEmail and checks any available institutional Auth
claims. A role or similar email prefix is never sufficient to infer an alias.
Duplicate emails, USNs, employee IDs, conflicting claims, occupied UIDs, mapping
chains, and destination document collisions abort the migration.

```powershell
# Replace N with the reviewed number of UID changes, not total Auth users.
node scripts/reconcile-production-uids.mjs --uri-file=C:/path/atlas-uri.txt --key-file=C:/path/service-account.json --apply --expect-mappings=N
```

Apply takes a fresh backup, then uses one majority-write Mongo transaction. Every
collection/document must still match the backup, otherwise it aborts. It updates
known UID fields including nested approval/history references, user/student/plan
IDs, notification paths, enrollment and marks IDs/references, workflow assignees,
identity reservations, provisioning callers, and account-exit records. Role keys,
names, employee IDs, approval keys, scores, reasons, statuses, and timestamps are
preserved. BSON scalar types are retained. Every resulting document is compared
with its expected value and collection counts are preserved. An idempotent rerun
reports no changes.

Unmatched accounts are reported, never provisioned or merged implicitly. Missing
production identities require an authoritative identity manifest and an explicit
production provisioning decision. Production activation uses the application's
existing activation/reset flow, not a hardcoded demo password.

There is no automatic rollback over live data. Before any recovery, compare the
private backup with current records and account for subsequent legitimate writes.
Do not blindly restore a collection over current production activity.

`npm test` includes focused reconciliation tests alongside the existing suite,
using only isolated audit Auth and disposable Mongo replica sets.

Application credentials remain environment-based. Rotate the Firebase service key
by replacing Render's `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`, then
redeploy/restart; no source change is needed. Never set
`FIREBASE_AUTH_EMULATOR_HOST` in production.
