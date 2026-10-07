// js/student-directory.js

import { db } from "./firebase-config.js";

import {
    collection,
    doc,
    writeBatch,
    getDocs,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";


let csvStudents = [];


/* =========================================
   INITIALIZE
========================================= */

export function initStudentDirectory() {

    const csvInput =
        document.getElementById("csvFileInput");

    const uploadBtn =
        document.getElementById("uploadCsvBtn");

    const searchInput =
        document.getElementById("studentSearch");


    if (csvInput) {
        csvInput.addEventListener(
            "change",
            handleCSVUpload
        );
    }


    if (uploadBtn) {
        uploadBtn.addEventListener(
            "click",
            uploadStudentsToFirestore
        );
    }


    if (searchInput) {
        searchInput.addEventListener(
            "input",
            searchStudent
        );
    }
}


/* =========================================
   READ CSV
========================================= */

function handleCSVUpload(event) {

    const file = event.target.files[0];

    const uploadBtn =
        document.getElementById("uploadCsvBtn");


    if (!file) {

        csvStudents = [];

        if (uploadBtn) {
            uploadBtn.disabled = true;
            uploadBtn.textContent = "Upload Students";
        }

        return;
    }


    if (!file.name.toLowerCase().endsWith(".csv")) {

        alert("Please select a CSV file.");

        event.target.value = "";

        return;
    }


    const reader = new FileReader();


    reader.onload = function (e) {

        try {

            csvStudents =
                parseCSV(e.target.result);


            console.log(
                "Students loaded:",
                csvStudents
            );


            if (csvStudents.length === 0) {

                alert(
                    "No valid students found in CSV."
                );

                if (uploadBtn) {
                    uploadBtn.disabled = true;
                }

                return;
            }


            showCSVPreview(csvStudents);


            /*
             * THIS is the part missing from
             * your old code.
             */

            if (uploadBtn) {

                uploadBtn.disabled = false;

                uploadBtn.textContent =
                    `Upload ${csvStudents.length} Students`;
            }


        } catch (error) {

            console.error(error);

            alert(
                "Could not read CSV: " +
                error.message
            );
        }
    };


    reader.readAsText(file);
}


/* =========================================
   PARSE CSV
========================================= */

function parseCSV(csvText) {

    const lines = csvText
        .split(/\r?\n/)
        .filter(line =>
            line.trim() !== ""
        );


    if (lines.length < 2) {
        return [];
    }


    const headers = lines[0]
        .split(",")
        .map(header =>
            header
                .trim()
                .toLowerCase()
                .replace(/^"|"$/g, "")
        );


    const students = [];


    for (
        let i = 1;
        i < lines.length;
        i++
    ) {

        const values = lines[i]
            .split(",")
            .map(value =>
                value
                    .trim()
                    .replace(/^"|"$/g, "")
            );


        const row = {};


        headers.forEach(
            (header, index) => {

                row[header] =
                    values[index] || "";
            }
        );


        const student = {

            name:
                row.student_name ||
                row.name ||
                "",

            uid:
                row.student_uid ||
                row.uid ||
                row.usn ||
                "",

            semester:
                Number(
                    row.student_semester ||
                    row.semester ||
                    0
                ),

            section:
                row.student_section ||
                row.section ||
                "",

            subjects:
                (
                    row.student_subjects ||
                    row.subjects ||
                    ""
                )
                    .split(";")
                    .map(subject =>
                        subject.trim()
                    )
                    .filter(Boolean)
        };


        /*
         * Don't import broken/incomplete rows.
         */

        if (
            student.name &&
            student.uid &&
            student.semester &&
            student.section
        ) {

            students.push(student);
        }
    }


    return students;
}


/* =========================================
   CSV PREVIEW
========================================= */

function showCSVPreview(students) {

    const preview =
        document.getElementById(
            "csvPreview"
        );


    if (!preview) return;


    preview.innerHTML = `

        <div class="banner">

            <strong>
                ${students.length}
                students detected
            </strong>

            <br>

            Review the records and click
            Upload Students.

        </div>


        <div class="student-results">

            ${students.map(student => `

                <div class="student-card">

                    <div>

                        <strong>
                            ${escapeHtml(
                                student.name
                            )}
                        </strong>

                        <p>

                            ${escapeHtml(
                                student.uid
                            )}

                            · Semester
                            ${student.semester}

                            · Section
                            ${escapeHtml(
                                student.section
                            )}

                        </p>

                        <small>

                            Subjects:

                            ${escapeHtml(
                                student.subjects.join(", ")
                            )}

                        </small>

                    </div>

                </div>

            `).join("")}

        </div>
    `;
}


/* =========================================
   UPLOAD TO FIRESTORE
========================================= */

async function uploadStudentsToFirestore() {

    const uploadBtn =
        document.getElementById(
            "uploadCsvBtn"
        );


    if (csvStudents.length === 0) {

        alert(
            "Choose a valid CSV file first."
        );

        return;
    }


    try {

        uploadBtn.disabled = true;

        uploadBtn.textContent =
            "Uploading...";


        /*
         * Firestore batch:
         * all 10 records are written together.
         */

        const batch =
            writeBatch(db);


        csvStudents.forEach(student => {

            /*
             * We use UID/USN as document ID
             * because it is unique.
             *
             * students/1AY24IS101
             */

            const studentRef =
                doc(
                    db,
                    "students",
                    student.uid
                );


            batch.set(
                studentRef,
                {
                    name:
                        student.name,

                    uid:
                        student.uid,

                    semester:
                        student.semester,

                    section:
                        student.section,

                    subjects:
                        student.subjects,

                    updatedAt:
                        new Date()
                },
                {
                    merge: true
                }
            );
        });


        await batch.commit();


        uploadBtn.textContent =
            "Uploaded Successfully ✓";


        alert(
            `${csvStudents.length} students successfully stored in Firestore.`
        );


        /*
         * Keep button disabled because
         * this exact CSV has already been uploaded.
         */

    } catch (error) {

        console.error(
            "Firestore upload error:",
            error
        );


        uploadBtn.disabled = false;

        uploadBtn.textContent =
            `Upload ${csvStudents.length} Students`;


        alert(
            "Upload failed: " +
            error.message
        );
    }
}


/* =========================================
   SEARCH FIRESTORE
========================================= */

async function searchStudent(event) {

    const searchText =
        event.target.value
            .trim()
            .toLowerCase();


    const resultBox =
        document.getElementById(
            "studentSearchResults"
        );


    if (!resultBox) return;


    if (!searchText) {

        resultBox.innerHTML = "";

        return;
    }


    resultBox.innerHTML = `

        <div class="muted">
            Searching Firestore...
        </div>
    `;


    try {

        const snapshot =
            await getDocs(
                collection(
                    db,
                    "students"
                )
            );


        const matches = [];


        snapshot.forEach(
            documentSnapshot => {

                const student =
                    documentSnapshot.data();


                const name =
                    String(
                        student.name || ""
                    ).toLowerCase();


                const uid =
                    String(
                        student.uid || ""
                    ).toLowerCase();


                if (
                    name.includes(searchText) ||
                    uid.includes(searchText)
                ) {

                    matches.push(student);
                }
            }
        );


        showSearchResults(matches);


    } catch (error) {

        console.error(
            "Student search error:",
            error
        );


        resultBox.innerHTML = `

            <div class="empty-search">

                Could not search students.

                <br>

                ${escapeHtml(
                    error.message
                )}

            </div>
        `;
    }
}


/* =========================================
   SEARCH RESULTS
========================================= */

function showSearchResults(students) {

    const resultBox =
        document.getElementById(
            "studentSearchResults"
        );


    if (students.length === 0) {

        resultBox.innerHTML = `

            <div class="empty-search">
                No student found.
            </div>
        `;

        return;
    }


    resultBox.innerHTML =
        students.map(student => `

            <div class="student-card">

                <div>

                    <strong>
                        ${escapeHtml(
                            student.name
                        )}
                    </strong>

                    <p>

                        ${escapeHtml(
                            student.uid
                        )}

                        · Sem ${student.semester}

                        · Sec
                        ${escapeHtml(
                            student.section
                        )}

                    </p>

                </div>


                <button
                    class="view-student-btn"
                    data-uid="${escapeHtml(
                        student.uid
                    )}"
                >
                    View
                </button>

            </div>

        `).join("");


    document
        .querySelectorAll(
            ".view-student-btn"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    viewStudent(
                        button.dataset.uid
                    );
                }
            );
        });
}


/* =========================================
   VIEW STUDENT FROM FIRESTORE
========================================= */

async function viewStudent(uid) {

    const modal =
        document.getElementById(
            "studentDetails"
        );


    if (!modal) return;


    try {

        /*
         * UID is the document ID,
         * so we can fetch the student directly.
         */

        const studentRef =
            doc(
                db,
                "students",
                uid
            );


        const snapshot =
            await getDoc(studentRef);


        if (!snapshot.exists()) {

            alert(
                "Student record not found."
            );

            return;
        }


        const student =
            snapshot.data();


        modal.innerHTML = `

            <div class="student-detail-card">

                <button
                    id="closeStudentDetails"
                    class="close-details"
                >
                    ×
                </button>


                <h2>
                    ${escapeHtml(
                        student.name
                    )}
                </h2>


                <p>

                    <strong>
                        UID / USN:
                    </strong>

                    ${escapeHtml(
                        student.uid
                    )}

                </p>


                <p>

                    <strong>
                        Semester:
                    </strong>

                    ${student.semester}

                </p>


                <p>

                    <strong>
                        Section:
                    </strong>

                    ${escapeHtml(
                        student.section
                    )}

                </p>


                <h3>
                    Subjects
                </h3>


                <ul>

                    ${(student.subjects || [])
                        .map(subject => `

                            <li>
                                ${escapeHtml(
                                    subject
                                )}
                            </li>

                        `)
                        .join("")}

                </ul>


                <div class="status-message">

                    Student record loaded
                    from Firestore.

                </div>

            </div>
        `;


        modal.classList.add(
            "show"
        );


        document
            .getElementById(
                "closeStudentDetails"
            )
            .addEventListener(
                "click",
                () => {

                    modal.classList.remove(
                        "show"
                    );
                }
            );


    } catch (error) {

        console.error(error);

        alert(
            "Could not load student: " +
            error.message
        );
    }
}


/* =========================================
   HTML SAFETY
========================================= */

function escapeHtml(value) {

    const div =
        document.createElement("div");

    div.textContent =
        String(value ?? "");

    return div.innerHTML;
}