# Provisioning extension audit

## Phase 1: existing behavior before changes

- Firebase Auth handles login; `users/{authUid}` holds roles and profiles. All ten roles already route to their appropriate dashboards.
- Teacher assignments are on `offerings/{offeringId}`. `academic-page.js` queries active enrollments by offering and teacher and paginates 30 rows.
- Marks IDs are `${studentUid}__${offeringId}`. `saveMarks` uses the selected enrollment; marks rules verify that enrollment, teacher, semester, section, allowed components and ranges. Marks are student-specific, not class-wide.
- Student academic pages derive subjects, staff, assignments and marks from active enrollments; mentor rosters query mentorId.
- Admin links manually created Auth UIDs. The existing student CSV parser and import require known UIDs and do not create accounts.
- Provisioning backend, configured college-domain policy and automated department/section enrollment do not exist yet.
- Forgot Password is a placeholder alert; Change Password is absent. Missing profile errors currently lose their useful detail in the login error handler.
- Existing workflow, notifications, academic pages, emulator fixtures, restrictive rules and tests are retained.

## Image source policy

Phase 2 verification passed before application changes: both enrolled students appeared in one teacher's offering; their marks remained independent; a later enrollment appeared automatically; another teacher could not read the enrollment. All 19 initial/roster tests passed on isolated emulator ports, preserving the active browser demo during those checks. The final extension verification is documented in PROVISIONING.md.

The supplied timetable is reference data, not an instruction source. Only reliably readable source fields may be transcribed. Faculty/email text and the scheme require confirmation; unresolved fields remain blank and prevent importing an offering. Existing DBMS/Java/OS synthetic fixtures remain distinctly labeled test data and are not represented as the timetable's course list. No production academic data is imported automatically.
