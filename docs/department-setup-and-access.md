# Department setup and account lifecycle

Creating a department creates its master and audit entry only. It does not provision an Admin, HOD, faculty, mentor, student, subject, class, enrollment or workflow record. It also does not attach legacy academic records by department name. A new department opens **Department Setup**, with unassigned leadership and zero academic counts.

Explicit setup order:

1. Assign or create the Department Admin.
2. Assign or create the HOD. Current teaching/mentoring responsibilities must be reassigned before an account is promoted into a different leadership role.
3. Configure the department's shared workflow services.
4. Import faculty, designating mentors with `is_mentor=true` on the same faculty identity.
5. Import subjects and faculty/class assignments.
6. Import students with valid mentor employee IDs. Their department is bound to the selected context; only matching department/scheme/semester/section offerings are enrolled.
7. Validate the setup checklist, review the confirmation checkbox and explicitly mark it Ready.

New student imports create identity, profile and academic mappings only. No-Due starts **Not submitted**. Requests, approval decisions, marks, notifications and hall tickets are created only by their explicit normal operations. Historical CSE demonstration records came from earlier deliberate test provisioning and workflow verification; creating another department does not copy them.

## Current HOD authority

The canonical department HOD assignment is checked on authenticated requests and login. A historical `role=hod` does not grant current HOD authority. Replacing the HOD restores a documented previous faculty/mentor role where valid; an HOD-only account becomes inactive in the institution. Auth UIDs, passwords and historical approval actors are retained. Pending, unapproved HOD assignments can transfer to the replacement with assignment history; already-approved and issued history remains unchanged.

Every protected page listens for session changes and checks the effective profile when focused or made visible. A changed account/role clears protected content and redirects. An intentional password-change logout retains its success notice and follows the existing Firebase password flow.

## Bulk exit

The directory supports page selection and state-aware deactivate/reactivate/permanent-removal actions. **Bulk Exit Management** additionally accepts one-column CSVs:

```csv
usn
```

or:

```csv
employee_id
```

Choose an action, upload, validate, inspect the preview, check confirmation and commit. Invalid identifiers block confirmation; protected accounts are identified before committing eligible rows. Backend authorization and dependency checks run again during each mutation. Download the full per-account report after preview/operation. Operations process at most 100 accounts per request and retain operation IDs for retries.

Permanent removal retains academic, workflow and audit dependencies, self, current leadership and shared services. Fresh users without history can be removed from Firebase Auth and Mongo setup, including unused owned classes that have no incoming dependencies. Subjects are shared masters and are retained. A faculty account with mentees or class history is protected. Removing fresh students first may make unused faculty/class setup eligible for a later preflight.

Production cleanup requires a fresh backup and an explicit reference audit. Do not delete issued hall tickets or historical approvals to make a demo look empty. Use a new department to demonstrate clean setup.
