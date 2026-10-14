# College data import and safe account management

Use College Data Import in the existing Admin/Super Admin workspace. A Department Admin can manage only their department; a Super Admin selects a department context or manages all departments.

Before importing, create/activate the department, schemes and sections, assign its HOD and workflow services, and configure the allowed college email domain in Institution Settings. CSV import does not relax the institution's email policy.

## Import order

1. Download **Faculty CSV Template**. Import faculty first. Set `is_mentor=true` for the faculty who also mentor students. They keep one UID, employee ID, password and teaching account; **My mentees** opens their mentor dashboard.
2. Download **Subject CSV Template**. Import subject masters.
3. Download **Faculty Assignment CSV Template**. Assign existing employee IDs to subjects, semesters and sections. Include an optional `scheme` column if a subject code exists in multiple schemes.
4. Download **Student CSV Template**. Use each mentor's existing employee ID in `mentor_employee_id`. Active offerings are enrolled automatically using department, scheme, semester and section.
5. Use **Validate Relationships** and **Show Mentor Mappings**, then inspect a random student's subjects and their teacher's roster.

Each file follows Select CSV → Validate & preview → review checkbox → Confirm. All rows must pass preflight; invalid files create no accounts. Confirmation processes ten rows per request with progress. A later infrastructure failure is reported per row and can be resumed using **Retry failed rows**. Download the report to see each outcome. Reimporting preserves existing UIDs, passwords, marks and completed workflow history; inactive identities require explicit reactivation.

## Template headers

Student (`templates/college-student-import.csv`):

```csv
usn,name,college_email,phone,department_code,semester,section,scheme,mentor_employee_id
```

Faculty (`templates/faculty-import.csv`):

```csv
employee_id,name,college_email,phone,department_code,is_mentor
```

Subject (`templates/subject-import.csv`):

```csv
subject_code,subject_name,department_code,semester,scheme
```

Faculty assignment (`templates/faculty-assignment-import.csv`):

```csv
employee_id,subject_code,semester,section,department_code
```

Templates intentionally contain headers only so example people cannot accidentally be provisioned. Existing camelCase student, teacher and offering templates remain supported. Offering components accept the existing JSON format or pipe-delimited labels.

## Directory and removal

The directory starts collapsed. Open it and select Active, Inactive or All; choose 25, 50 or 100 rows per page. Search by name, email, USN or employee ID and filter department, role, semester and section. **Select all visible** selects only the current page.

Deactivate/reactivate actions depend on current state and preserve history. Permanent removal first classifies each selected account, then requires a checkbox to remove only safe accounts. It protects self, last Super Admin, leadership, shared services, teaching/mentee responsibilities and academic/workflow/audit history. Accounts with history must be deactivated. Fresh accounts without dependencies can be removed from Auth and active setup records. Interrupted removals stay blocked and resume with the same operation ID.

## Performance and validation

GET deduplication lasts only while a request is running. Page-initialization master data is reused and invalidated after administrative changes. Dynamic marks, approvals, request status and directory results are not cached. Academic and mentor summaries use batched queries; directory rows are paginated on the server. A slow-request banner appears after six seconds; Render Free cold starts remain a hosting limitation.

Run `npm test` from `server/`. Tests use loopback Auth in `demo-mongo-audit` and disposable in-memory Mongo databases. They perform real Chrome CSV imports at 200 students/30 faculty/7 faculty mentors and API stress tests at 500 students/50 faculty, plus scope, error, repeat-import, removal and workflow checks. Never point this harness at production.

The operator script `server/scripts/audit-institutional-identities.mjs` is read-only by default. It requires explicit local URI/credential paths and output directory. `--apply` makes a verified full backup first and only adds missing, nonconflicting identity reservations. It does not repair incomplete historical fixture profiles by inventing identities or deleting history.
