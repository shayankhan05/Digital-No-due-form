# Local emulator demo: Semester 5, Section C

The provisioning extension is documented in [PROVISIONING.md](PROVISIONING.md). Install `functions/` dependencies with `npm ci` before preview; preview now also starts Functions and exports/imports local state. Use `npm run audit` for the full isolated test suite. The procedures below remain the original two-student workflow walkthrough.

This procedure uses project `demo-digital-no-due` exclusively. The seed does not import production configuration or credentials. Auth writes go to `127.0.0.1:9199`; Firestore writes go to `127.0.0.1:8180`. The dedicated local Hosting port 5050 automatically selects this demo project with a dummy API key. An unavailable emulator causes failure; there is no production fallback in this mode. No Firebase login or deploy is required.

## 1. Start emulators

Node and Java are already installed on this machine; the validated versions are Node 24 and Java 26. Open PowerShell terminal A:

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form\tests"
npm ci
npm run preview
```

`npm ci` is needed only for first installation or changed dependencies. Keep terminal A running. Wait for **All emulators ready**. If the emulators started by Codex are still running, skip this step; do not start a second instance on the same ports.

## 2. Seed and verify

Open PowerShell terminal B:

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form\tests"
npm run seed
npm run verify:demo
```

The repeatable seed reuses existing demo Auth accounts with the same password. It refuses conflicting roles/profiles or unexpected environment project/endpoint values. It resets the known demo profiles, class mappings, marks and assignments and preserves existing No-Due requests/notifications. Do not reseed between changing marks and checking them. No No-Due request is created by the seed or verifier. Verification briefly changes CS501 IA1 to 23, checks it as the student, and restores the original marks.

The preview now exports data on normal shutdown to `local-emulator-backup/current` and imports that export on restart. A forced termination may lose changes since the last export. Reseeding alone preserves request history and resets known demo academic fixtures; it is not a clean-request reset.

## 3. Open the application

```powershell
Start-Process "http://127.0.0.1:5050/login.html?emulator=1"
```

Application: http://127.0.0.1:5050/login.html?emulator=1

Emulator UI: http://127.0.0.1:4500

Use this URL for the entire walkthrough. The explicit switch persists across redirects in that tab; port 5050 also enables emulator mode in new local tabs. Use **Sign out** before switching accounts in one browser. Authentication is shared across tabs on the same origin, so use sequential sign-outs/logins or separate browser profiles for simultaneous roles.

## 4. Working credentials

Every password below is exactly **`DemoPassword123!`** (case-sensitive).

| Role | Email |
| --- | --- |
| admin | admin@demo.test |
| student | student@demo.test |
| subject_faculty | subject_faculty@demo.test |
| mentor | mentor@demo.test |
| hod | hod@demo.test |
| office | office@demo.test |
| library | library@demo.test |
| physics_lab | physics_lab@demo.test |
| chemistry_lab | chemistry_lab@demo.test |
| accounts | accounts@demo.test |
| subject_faculty — Java teacher | java_faculty@demo.test |
| subject_faculty — OS teacher | os_faculty@demo.test |
| student — privacy comparison | student2@demo.test |

Enter email/password on the login page and click **Log in**. Routing selects the dashboard for the stored role. Admin can inspect seeded records; no additional setup is required.

## Seeded academic example

- Asha Demo, USN **DEMO5C001**, student@demo.test, phone 0000000000, Computer Science, semester **5**, section **C**.
- Mentor: **Demo mentor**, mentor@demo.test; both students are assigned to this mentor.
- Comparison student: Ravi Demo, **DEMO5C002**, student2@demo.test, same class with separate marks and private notification path.
- Each subject has IA1 /30, IA2 /30 and Assignment /10, an active enrollment, a current teacher assignment and one assignment notice due **2026-10-10**.
- Codes below are demo codes, not a claim about the college's official curriculum.

| Subject | Code | Assigned teacher | IA1 | IA2 | Assignment marks | Assignment notice |
| --- | --- | --- | --- | --- | --- | --- |
| Database Management Systems | CS501 | subject_faculty@demo.test | 22/30 | 24/30 | 8/10 | SQL joins and aggregates |
| Java Programming | CS502 | java_faculty@demo.test | 21/30 | 23/30 | 7/10 | Java inheritance exercise |
| Operating Systems | CS503 | os_faculty@demo.test | 25/30 | 26/30 | 9/10 | CPU scheduling exercise |

Offering IDs: `demo-dbms-5-C`, `demo-java-5-C`, `demo-os-5-C`. Subject IDs: `demo-dbms`, `demo-java`, `demo-os`. Actual Auth UIDs are printed by the seed; profiles, enrollments, marks and plans use those UIDs, not guessed IDs.

Each student's prepared plan contains **7 Stage 1 approvals**: the three assigned teachers, library, physics_lab, chemistry_lab and accounts. Later assignments are mentor@demo.test → hod@demo.test → office@demo.test. Both plans are marked valid.

## 5. Teacher marks update

1. Log in as **subject_faculty@demo.test**.
2. Open **Profile, My Students & Marks**.
3. Select **Database Management Systems · CS501 · Sem 5 / C**.
4. Locate **Asha Demo / DEMO5C001**; change **Internal Assessment 1** from **22** to **27**, and **Assignment** from **8** to **9**. Keep IA2 **24**.
5. Click **Save marks** on Asha's row and wait for **Marks saved**.

## 6. Student sees updated marks

1. Sign out; log in as **student@demo.test**.
2. Open **Profile, Subjects, Marks & Assignments**.
3. Under CS501, verify **27/30**, **24/30**, **9/10**. Reload the academic page if already open.
4. Verify all three subjects, teacher names, mentor and assignment notices. Student marks are read-only.

## 7. Teacher rejects with a reason

1. As student@demo.test, return to the dashboard and open the new No-Due request screen (direct local URL: http://127.0.0.1:5050/create-request.html?emulator=1).
2. Verify Semester **5**, Section **C**, Asha's USN and all seven required approvers. Tick the confirmation checkbox and click **Submit request**.
3. Sign out; log in as **subject_faculty@demo.test** and open the approval desk's **Requests** view.
4. Find **Asha Demo / DEMO5C001 / CS501**. Click **Reject**.
5. In **Reason for rejection**, enter exactly **SQL assignment corrections required**. Click **Confirm rejection**.
6. The request becomes `rejected`. An empty reason cannot be submitted successfully.

## 8. Verify private rejection notification

1. Log in as **student@demo.test**; click **Refresh status & notifications**.
2. Verify the request's rejection and reason **SQL assignment corrections required**. Its notification identifies the teacher/subject and reason.
3. Sign out; log in as **student2@demo.test**. Check the dashboard and notifications. Ravi must not see Asha's rejection or request. In a fresh walkthrough Ravi has no notifications.
4. Optional terminal verification: `npm run verify:demo` verifies Firestore denies Ravi access to Asha's notification collection, even when querying its exact path. It restores the marks it finds, so the manual 27/24/9 values remain after this check.

## 9. Resubmit

1. Log in as **student@demo.test**.
2. After the simulated assignment correction, click **Resubmit Request** for the rejected request.
3. Verify the request returns to `pending_stage1` and CS501 becomes pending. Rejection notification history remains visible; any previously approved Stage 1 items remain approved.
4. This resubmits the same No-Due request. Assignment notices are informational; there is no file-upload or LMS submission step implemented.

## 10. Complete Stage 1 → Mentor → HOD → Office

For each row below, sign out, log in with that email and the shared password, find **DEMO5C001**, and click **Approve** on the appropriate request item:

| Sign-in | Approve |
| --- | --- |
| subject_faculty@demo.test | CS501 / Database Management Systems |
| java_faculty@demo.test | CS502 / Java Programming |
| os_faculty@demo.test | CS503 / Operating Systems |
| library@demo.test | Library |
| physics_lab@demo.test | Physics lab |
| chemistry_lab@demo.test | Chemistry lab |
| accounts@demo.test | Accounts |

After all seven approvals, the request automatically becomes **`pending_mentor`**.

1. Log in as **mentor@demo.test**; find DEMO5C001 in actionable requests and click **Approve** → **`pending_hod`**.
2. Log in as **hod@demo.test**; approve DEMO5C001 → **`cleared`**.
3. Log in as **office@demo.test**; find the cleared request (or search exact USN **DEMO5C001**), click **Issue Hall Ticket**, and accept its confirmation → **`issued`**.
4. Log in as **student@demo.test**, refresh status/notifications, and verify **Hall ticket issued**, completed approval progress and the corresponding event history. Ravi still cannot see Asha's private events.

## Automated workflow/security checks

With the emulators running, execute this **before** seeding a manual demo:

```powershell
cd "C:\Users\Hp\Desktop\College Projects\Digital-No-Due-Form\tests"
npm test
npm run seed
npm run verify:demo
```

`npm test` clears the **demo Firestore emulator** and creates separate test fixtures. It must not run during a manual walkthrough whose records you want to preserve. Expected permission-denied logs are successful negative-access checks; the final result should report **18 tests, 18 passed, 0 failed**. Stop terminal A with Ctrl+C when finished. No production deployment, import, deletion or account creation is part of this procedure.
