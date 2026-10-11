# Student CSV provisioning

The existing admin CSV UI calls `previewAccounts`, then `provision` for each
validated row. The server resolves the institutional email and USN together
before creating an Authentication account. Both must identify one active student
with matching department, scheme, semester, section and mentor.

For an existing Mongo student missing Firebase Auth, re-import the matching CSV.
The same server path creates Auth with the existing institutional UID, checks
email/UID collisions and identity reservations, and preserves existing profiles,
passwords, marks, requests and approval history. Existing active Auth accounts
are reused; their passwords are never reset. Inactive or disabled accounts require
the existing explicit administrative reactivation workflow.

Production normally uses the existing Firebase activation-email flow. A demo
institution may explicitly enable `demoStudentProvisioningEnabled: true` in its
`institutionPolicy/institution` document. This enables the existing temporary
demo-password policy only for student addresses ending in `@demo.test`. It does
not enable demo staff provisioning or redirect production Firebase calls to an
emulator. The password is not returned in production responses or persisted in
MongoDB, CSV reports or provisioning jobs. Temporary-password reminders remain
dismissible and are cleared only by the existing verified password-change flow.

Do not enable this demo-only policy for an ordinary institutional deployment.
Changing the policy does not alter existing Auth credentials. Configure normal
college domains and activation delivery for real institutional accounts.

The CSV import's existing enrollment and workflow builders remain responsible
for matching active offerings. Repairs retain the student's canonical UID and
preserve existing enrollments while refreshing the derived mappings.

Run `npm test` from `server` for isolated regression coverage. Never point tests
at the production Auth project or current working development emulator.
