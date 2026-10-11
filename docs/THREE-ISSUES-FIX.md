# Three-issue repair — 10 October 2026

This pass changes the active Firebase Auth/Hosting + Express/MongoDB application. It does not edit the legacy Firestore application, deploy, push, or change the No-Due workflow or role permissions.

## Responsive layout

The final CSS overrides retained a 480px authenticated shell from the earlier phone-style layout request. Authenticated `.app-shell` and `.academic-links` now use responsive gutters and a shared 1800px maximum, including admin pages. Below 520px they fill the viewport; desktop content gets 24px padding. Login remains compact. Theme, fonts, cards, wrapping, table scrolling and bottom navigation are preserved.

Chrome measurements for Student Requests and teacher dashboards:

| Viewport | Shell width | Horizontal page overflow |
|---|---:|---|
| 390 | 390 | None |
| 768 | 737 | None |
| 1024 | 983 | None |
| 1366 | 1311 | None |
| 1920 | 1800 | None |

The regression suite also checks student profile/new request/academics, teacher academics/profile, Mentor, HOD, Office, Library, Accounts and both admin pages at all five widths. Screenshots are local gitignored artifacts under `server/test/browser-artifacts/`.

## Rejection editor

The three-second query polling callbacks replaced the approval list with `innerHTML`, destroying the active textarea and focus. The shared editor now stores drafts by request plus approval/stage key. Polling updates the data but defers list rendering while an editor is mounted. Keystrokes only update the local draft; Confirm Reject uses the existing workflow action. Cancel discards the draft without submitting. Successful submission releases the draft so subsequent resubmissions can appear on the same page.

The Chrome regression types `Assignment pending. Please submit before clearance.` character by character across several polls, checks mounting/focus/text, cancels, reopens and submits, verifies the persisted reason and student Requests screen, and checks that resubmission reappears. It covers faculty, Library, Accounts, Mentor and HOD.

## Mandatory password change

New provisioning already set the flag, but historical restored seed profiles lacked it. Seed now repairs eligible local demo profiles using seed/provisioning provenance and Auth timestamps. It does not inspect entered passwords to classify temporary credentials. Explicitly completed flags, recorded completed changes and evidence of later Auth changes are skipped; unknown provenance is left untouched.

The local repair flagged 93 profiles and skipped 10 without adequate provenance. No passwords were changed. Firebase emulator imports rewrite password timestamps; startup therefore rebases still-pending issuance timestamps before starting the API. Otherwise an import could be mistaken for a real password change.

The frontend redirects flagged users to the blocking password page. The API independently rejects normal operations. Only verified Firebase password-update metadata clears the flag. Users remain gated after refresh/login; completed users are not interrupted. Password flags live on the user profile, rather than being copied into student academic profiles.

Chrome tested the complete default login → forced page → blocked dashboard → change → logout → old password fails → new password succeeds sequence for isolated student and teacher accounts. Current `student@demo.test` and `sana.mir@demo.test` were additionally checked read-only for forced redirect, direct-dashboard blocking and refresh enforcement. Their current passwords were not changed by verification.

## Data preservation and runtime note

Document-for-document comparisons matched 388 student profiles, 14 marks records, 560 enrollments, 23 offerings, 10 requests, 59 approvals and 8 hall tickets. User profiles changed only in password-policy metadata. All 103 Auth identities and saved credential hashes matched the saved export.

During API reload, stopping the old launcher unexpectedly also stopped Auth/Hosting. They were restarted from the saved Auth export; MongoDB stayed running. The comparisons above were performed after restoration. There was no database reset or password reset. Automated mutations ran only against isolated Auth port 9298, API 3001 and a temporary MongoDB replica set.

## Files changed in this pass

Final `npm test`: **33 passed, 0 failed, 0 skipped**, including installed Google Chrome running headlessly against the isolated audit services. Syntax checks and `git diff --check` passed. The authenticated layout screenshots were visually inspected at all five requested widths.

- `css/style.css`
- `js/rejection-editor.js` (new)
- `js/approver.js`, `js/mentor.js`, `js/hod.js`
- `js/auth.js`
- `server/src/services/authentication.js`
- `server/src/services/demo-password-policy.js` (new)
- `server/src/services/provisioning.js`
- `server/scripts/seed-local.mjs`, `server/scripts/local.mjs`
- `server/scripts/repair-demo-passwords.mjs` (new, local-only repair with timestamped audit snapshots)
- `server/test/migration.test.mjs`
- `README.md`, `docs/FINAL-IMPROVEMENTS.md`, this report

Earlier uncommitted project changes were preserved. Temporary diagnostic scripts were removed after verification; their local audit results remain gitignored.
