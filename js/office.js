import { db } from "./firebase-config.js";
import { requireAuth, wireLogout } from "./auth.js";
import {
  issueHallTicket,
  STATUS,
  statusLabel
} from "./workflow.js";

import { initThemeToggle } from "./theme.js";

import {
  collection,
  query,
  where,
  getDocs, limit, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";


// ============================================================
// BASIC SETUP
// ============================================================

wireLogout();
initThemeToggle();

const content =
  document.getElementById("content");

const header =
  document.getElementById("officeHeader");

const dashboardNav =
  document.getElementById("officeDashboardNav");

const profileNav =
  document.getElementById("officeProfileNav");


let officer = null;


// ============================================================
// AUTHENTICATION
// ============================================================

requireAuth(["office"]).then(async (profile) => {

  officer = profile;

  if (header) {
    header.textContent =
      `${profile.name || "Office"} · Office`;
  }

  setupNavigation();

  if (window.location.hash === "#profile") {
    showProfile();
  } else {
    await showDashboard();
  }

}).catch((error) => {

  console.error(error);

  content.innerHTML = `
    <div class="center-state">
      Unable to load office dashboard.
    </div>
  `;

});


// ============================================================
// NAVIGATION
// ============================================================

function setupNavigation() {

  if (dashboardNav) {

    dashboardNav.addEventListener(
      "click",
      async (event) => {

        event.preventDefault();

        window.history.replaceState(
          null,
          "",
          "office-dashboard.html"
        );

        setActiveNav("dashboard");

        await showDashboard();

        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });

      }
    );

  }


  if (profileNav) {

    profileNav.addEventListener(
      "click",
      (event) => {

        event.preventDefault();

        window.history.replaceState(
          null,
          "",
          "#profile"
        );

        setActiveNav("profile");

        showProfile();

        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });

      }
    );

  }

}


// ============================================================
// ACTIVE NAV
// ============================================================

function setActiveNav(page) {

  dashboardNav?.classList.remove("active");
  profileNav?.classList.remove("active");

  if (page === "dashboard") {
    dashboardNav?.classList.add("active");
  }

  if (page === "profile") {
    profileNav?.classList.add("active");
  }

}


// ============================================================
// DASHBOARD
// ============================================================

async function showDashboard() {

  setActiveNav("dashboard");

  content.innerHTML = `
    <div class="center-state">
      Loading cleared students…
    </div>
  `;

  try {

    /*
      STATUS.CLEARED means:

      Stage 1 ✓
      Mentor ✓
      HOD ✓

      Therefore the student is now ready
      for hall-ticket issuance.
    */

    const clearedQuery = query(
      collection(db, "noDueRequests"),
      where("status", "==", STATUS.CLEARED), where("officeId", "==", officer.uid), limit(30)
    );

    const clearedSnapshot =
      await getDocs(clearedQuery);


    const clearedStudents =
      clearedSnapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        .sort((a, b) =>
          (b.createdAt?.seconds || 0) -
          (a.createdAt?.seconds || 0)
        );


    renderDashboard(clearedStudents);

  } catch (error) {

    console.error(error);

    content.innerHTML = `
      <div class="center-state">
        Couldn't load cleared students.
        <br>
        <span class="muted">
          ${escapeHtml(error.message)}
        </span>
      </div>
    `;

  }

}


// ============================================================
// DASHBOARD HTML
// ============================================================

function renderDashboard(students) {

  content.innerHTML = `

    <!-- INTRO -->

    <div class="banner" style="margin-bottom:18px;">

      Students appear here automatically after completing
      all department, faculty, mentor and HOD approvals.

    </div>


    <!-- STATISTICS -->

    <div
      class="stat-grid"
      style="margin-bottom:18px;">

      <div class="stat-card">

        <div class="num">
          ${students.length}
        </div>

        <div class="label">
          Ready to Issue
        </div>

      </div>

    </div>


    <!-- SEARCH -->

    <div
      class="card"
      style="margin-bottom:18px;">

      <h2 style="margin-top:0;">
        Search Student
      </h2>

      <div
        style="
          display:flex;
          gap:8px;
          align-items:center;
        ">

        <input
          id="usnInput"
          type="text"
          placeholder="Enter USN"
          style="
            margin:0;
            flex:1;
          "
        />

        <button
          id="searchBtn"
          class="btn-primary"
          style="
            white-space:nowrap;
          ">
          Search
        </button>

      </div>

      <p
        class="muted"
        style="
          margin-bottom:0;
          margin-top:10px;
        ">

        Search a student's clearance and hall-ticket status
        using their USN.

      </p>

    </div>


    <!-- SEARCH RESULT -->

    <div id="searchResult"></div>


    <!-- READY STUDENTS -->

    <div
      style="
        margin-top:20px;
        margin-bottom:10px;
      ">

      <h2 style="margin-bottom:4px;">
        Ready for Hall Ticket
      </h2>

      <p
        class="muted"
        style="margin-top:0;">

        Students who have completed the full approval process.

      </p>

    </div>


    <div id="clearedStudents">

      ${
        students.length === 0

        ? `

          <div class="center-state">
            No students are waiting for hall-ticket issuance.
          </div>

        `

        : students
            .map((student) =>
              clearedStudentCard(student)
            )
            .join("")
      }

    </div>

  `;


  // ----------------------------------------------------------
  // SEARCH EVENTS
  // ----------------------------------------------------------

  const searchButton =
    document.getElementById("searchBtn");

  const usnInput =
    document.getElementById("usnInput");


  searchButton?.addEventListener(
    "click",
    searchStudent
  );


  usnInput?.addEventListener(
    "keydown",
    (event) => {

      if (event.key === "Enter") {
        searchStudent();
      }

    }
  );


  // ----------------------------------------------------------
  // ISSUE BUTTONS
  // ----------------------------------------------------------

  document
    .querySelectorAll(".issue-ticket-btn")
    .forEach((button) => {

      button.addEventListener(
        "click",
        async () => {

          const requestId =
            button.dataset.requestId;

          const studentName =
            button.dataset.studentName;

          const usn =
            button.dataset.usn;


          const confirmed = confirm(
            `Confirm hall ticket issuance for ${studentName} (${usn})?`
          );


          if (!confirmed) {
            return;
          }


          button.disabled = true;

          button.textContent =
            "Issuing…";


          try {

            await issueHallTicket(
              requestId,
              officer?.name
            );


            alert(
              `Hall ticket issued successfully for ${studentName}.`
            );


            await showDashboard();

          } catch (error) {

            console.error(error);

            alert(
              "Could not issue hall ticket: " +
              error.message
            );


            button.disabled = false;

            button.textContent =
              "Issue Hall Ticket";

          }

        }
      );

    });

}


// ============================================================
// CLEARED STUDENT CARD
// ============================================================

function clearedStudentCard(student) {

  const initials =
    getInitials(student.studentName);


  return `

    <div
      class="card"
      style="margin-bottom:14px;">

      <div
        style="
          display:flex;
          align-items:center;
          gap:14px;
          margin-bottom:16px;
        ">


        <!-- AVATAR -->

        <div
          class="avatar"
          style="
            width:52px;
            height:52px;
            min-width:52px;
            display:flex;
            align-items:center;
            justify-content:center;
            font-size:18px;
            font-weight:700;
          ">

          ${escapeHtml(initials)}

        </div>


        <!-- STUDENT DETAILS -->

        <div style="flex:1;">

          <div
            class="row-label"
            style="
              font-size:17px;
              margin-bottom:4px;
            ">

            ${escapeHtml(
              student.studentName || "Student"
            )}

          </div>


          <div class="row-sub">

            ${escapeHtml(student.usn || "")}

            ${
              student.semester
                ? ` · Sem ${escapeHtml(student.semester)}`
                : ""
            }

            ${
              student.section
                ? ` · Sec ${escapeHtml(student.section)}`
                : ""
            }

          </div>

        </div>


        <!-- STATUS -->

        <span class="badge badge-approved">

          Fully Cleared

        </span>

      </div>


      <!-- CLEARANCE INFORMATION -->

      <div
        class="banner"
        style="margin-bottom:14px;">

        ✓ Stage 1 approved
        <br>

        ✓ Mentor approved
        <br>

        ✓ HOD approved

      </div>


      <!-- ISSUE BUTTON -->

      <button
        class="btn-primary btn-block issue-ticket-btn"

        data-request-id="${escapeHtml(student.id)}"

        data-student-name="${escapeHtml(
          student.studentName || "Student"
        )}"

        data-usn="${escapeHtml(
          student.usn || ""
        )}">

        Issue Hall Ticket

      </button>

    </div>

  `;

}


// ============================================================
// SEARCH STUDENT
// ============================================================

async function searchStudent() {

  const input =
    document.getElementById("usnInput");

  const searchResult =
    document.getElementById("searchResult");


  if (!input || !searchResult) {
    return;
  }


  const usn =
    input.value.trim();


  if (!usn) {

    alert("Please enter a USN.");

    return;

  }


  searchResult.innerHTML = `

    <div class="center-state">
      Searching…
    </div>

  `;


  try {

    const studentQuery =
      query(
        collection(db, "noDueRequests"),
        where("usn", "==", usn), where("officeId", "==", officer.uid), orderBy("createdAt", "desc"), limit(10)
      );


    const snapshot =
      await getDocs(studentQuery);


    if (snapshot.empty) {

      searchResult.innerHTML = `

        <div class="center-state">

          No request found for
          ${escapeHtml(usn)}.

        </div>

      `;

      return;

    }


    const requests =
      snapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        .sort((a, b) =>
          (b.createdAt?.seconds || 0) -
          (a.createdAt?.seconds || 0)
        );


    const request =
      requests[0];


    const approvalsSnapshot =
      await getDocs(
        collection(
          db,
          "noDueRequests",
          request.id,
          "approvals"
        )
      );


    const approvalItems =
      approvalsSnapshot.docs.map(
        (docSnap) => docSnap.data()
      );


    renderSearchResult(
      request,
      approvalItems
    );

  } catch (error) {

    console.error(error);

    searchResult.innerHTML = `

      <div class="center-state">

        Search failed.

        <br>

        <span class="muted">
          ${escapeHtml(error.message)}
        </span>

      </div>

    `;

  }

}


// ============================================================
// SEARCH RESULT
// ============================================================

function renderSearchResult(
  request,
  items
) {

  const searchResult =
    document.getElementById("searchResult");


  if (!searchResult) {
    return;
  }


  const eligible =
    request.status === STATUS.CLEARED;


  const alreadyIssued =
    request.status === STATUS.ISSUED;


  const initials =
    getInitials(request.studentName);


  const checklistRows = [

    ...items.map((item) =>
      checkRow(
        item.label ||
        item.approverType,
        item.status
      )
    ),

    checkRow(
      "Mentor",
      request.mentorApproval?.status
    ),

    checkRow(
      "HOD",
      request.hodApproval?.status
    )

  ].join("");


  searchResult.innerHTML = `

    <div
      class="card"
      style="margin-bottom:18px;">


      <!-- STUDENT -->

      <div
        style="
          display:flex;
          align-items:center;
          gap:12px;
          margin-bottom:14px;
        ">


        <div
          class="avatar"
          style="
            width:46px;
            height:46px;
            min-width:46px;
            display:flex;
            align-items:center;
            justify-content:center;
            font-weight:700;
          ">

          ${escapeHtml(initials)}

        </div>


        <div style="flex:1;">

          <p
            style="
              margin:0;
              font-weight:600;
            ">

            ${escapeHtml(
              request.studentName || "Student"
            )}

          </p>


          <p
            class="muted"
            style="margin:3px 0 0;">

            ${escapeHtml(request.usn || "")}

            ${
              request.semester
                ? ` · Sem ${escapeHtml(request.semester)}`
                : ""
            }

            ${
              request.section
                ? ` · Sec ${escapeHtml(request.section)}`
                : ""
            }

          </p>

        </div>


        <span
          class="badge ${
            eligible || alreadyIssued
              ? "badge-approved"
              : "badge-pending"
          }">

          ${
            alreadyIssued
              ? "Hall Ticket Issued"
              : eligible
                ? "Ready to Issue"
                : escapeHtml(
                    statusLabel(request.status)
                  )
          }

        </span>

      </div>


      <!-- APPROVAL CHECKLIST -->

      <div
        class="list"
        style="margin-bottom:14px;">

        ${checklistRows}

      </div>


      <!-- ISSUE BUTTON -->

      <button
        id="searchedIssueBtn"
        class="btn-primary btn-block"

        ${
          eligible
            ? ""
            : "disabled"
        }>

        ${
          alreadyIssued
            ? "✓ Hall Ticket Issued"
            : eligible
              ? "Issue Hall Ticket"
              : "Approval Process Incomplete"
        }

      </button>

    </div>

  `;


  const issueButton =
    document.getElementById(
      "searchedIssueBtn"
    );


  if (eligible && issueButton) {

    issueButton.addEventListener(
      "click",
      async () => {

        const confirmed =
          confirm(
            `Confirm hall ticket issuance for ${request.studentName} (${request.usn})?`
          );


        if (!confirmed) {
          return;
        }


        issueButton.disabled = true;

        issueButton.textContent =
          "Issuing…";


        try {

          await issueHallTicket(
            request.id,
            officer?.name
          );


          issueButton.textContent =
            "✓ Hall Ticket Issued";


          alert(
            `Hall ticket issued successfully for ${request.studentName}.`
          );


          await showDashboard();

        } catch (error) {

          console.error(error);

          alert(
            "Could not issue hall ticket: " +
            error.message
          );


          issueButton.disabled = false;

          issueButton.textContent =
            "Issue Hall Ticket";

        }

      }
    );

  }

}


// ============================================================
// CHECKLIST ROW
// ============================================================

function checkRow(label, status) {

  let cssClass =
    "badge-pending";

  let text =
    "Pending";


  if (status === "approved") {

    cssClass =
      "badge-approved";

    text =
      "Approved";

  }


  if (status === "rejected") {

    cssClass =
      "badge-rejected";

    text =
      "Rejected";

  }


  return `

    <div class="row">

      <span class="row-label">

        ${escapeHtml(label || "Approval")}

      </span>

      <span
        class="badge ${cssClass}">

        ${text}

      </span>

    </div>

  `;

}


// ============================================================
// PROFILE
// ============================================================

function showProfile() {

  setActiveNav("profile");


  const name =
    officer?.name ||
    "Office";


  const email =
    officer?.email ||
    "—";


  const initials =
    getInitials(name);


  content.innerHTML = `

    <!-- PROFILE HEADER -->

    <div
      class="card"
      style="
        text-align:center;
        padding:36px 24px;
        margin-bottom:18px;
      ">


      <div
        class="avatar"
        style="
          width:120px;
          height:120px;
          margin:0 auto 22px;
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:38px;
          font-weight:700;
          background:var(--surface-2, #f1f5f9);
          color:var(--navy, #0b2545);
          border:4px solid var(--border, #dfe3e8);
        ">

        ${escapeHtml(initials)}

      </div>


      <h1
        style="
          margin:0 0 6px;
          font-size:28px;
        ">

        ${escapeHtml(name)}

      </h1>


      <p
        class="muted"
        style="
          margin:0;
          font-size:16px;
        ">

        Office

      </p>

    </div>


    <!-- PERSONAL DETAILS -->

    <div class="card">

      <h2 style="margin-top:0;">

        Personal Details

      </h2>


      ${profileRow(
        "Name",
        name
      )}


      ${profileRow(
        "Email",
        email
      )}


      ${profileRow(
        "Role",
        "Office"
      )}


      ${profileRow(
        "Department",
        officer?.department ||
        "Administration"
      )}

    </div>

  `;

}


// ============================================================
// PROFILE ROW
// ============================================================

function profileRow(label, value) {

  return `

    <div
      style="
        display:flex;
        justify-content:space-between;
        gap:20px;
        padding:14px 0;
        border-bottom:1px solid var(--border, #ddd);
      ">

      <span class="muted">

        ${escapeHtml(label)}

      </span>


      <strong
        style="
          text-align:right;
          word-break:break-word;
        ">

        ${escapeHtml(value || "—")}

      </strong>

    </div>

  `;

}


// ============================================================
// INITIALS
// ============================================================

function getInitials(name) {

  if (!name) {
    return "OF";
  }


  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) =>
      word.charAt(0).toUpperCase()
    )
    .join("");

}


// ============================================================
// SAFE HTML
// ============================================================

function escapeHtml(value) {

  const div =
    document.createElement("div");

  div.textContent =
    String(value ?? "");

  return div.innerHTML;

}
