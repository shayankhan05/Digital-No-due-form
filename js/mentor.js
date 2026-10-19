import {departmentLabel} from './department.js';
import {createRejectionEditor} from './rejection-editor.js';
const rejectionEditor = createRejectionEditor(document.getElementById('content'));
import { db } from "./firebase-config.js";
import { requireAuth, wireLogout } from "./auth.js";
import { actAsMentor, STATUS } from "./workflow.js";
import { initThemeToggle } from "./theme.js";
import {apiFetch} from './api.js';

import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs, limit
} from "./api-store.js";

/* =========================================================
   BASIC SETUP
========================================================= */

wireLogout();
initThemeToggle();

const content = document.getElementById("content");
const header = document.getElementById("mentorHeader");

const dashboardNav = document.getElementById("dashboardNav");
const profileNav = document.getElementById("profileNav");

let currentMentor = null;
let mentees = [];
let menteeCursor = null;
let moreMentees = false;
let loadingMentees = false;
let pendingRequests = [];
let unsubscribeRequests;
window.addEventListener("pagehide", () => unsubscribeRequests?.());


/* =========================================================
   START MENTOR PAGE
========================================================= */

requireAuth(["mentor"])
  .then(async (mentor) => {

    currentMentor = mentor;

    if (header) {
      header.textContent = "Digital No-Due";
    }

    setupNavigation();

    // Show page IMMEDIATELY.
    // Do not wait for Firestore.
    if (window.location.hash === "#profile") {

      setActiveNav("profile");
      showProfile();

    } else {

      setActiveNav("dashboard");
      showDashboard();
    }

    // Load Firestore information in background.
    loadMentees();

    listenForPendingRequests();

  })
  .catch((error) => {

    console.error("Mentor page error:", error);

    if (content) {
      content.innerHTML = `
        <div class="center-state">
          Could not load mentor dashboard.
          <br><br>
          ${escapeHtml(error.message || "")}
        </div>
      `;
    }

  });


/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {

  if (dashboardNav) {

    dashboardNav.addEventListener("click", (event) => {

      event.preventDefault();

      window.history.replaceState(
        null,
        "",
        "mentor-dashboard.html"
      );

      setActiveNav("dashboard");

      showDashboard();

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });

    });

  }


  if (profileNav) {

    profileNav.addEventListener("click", (event) => {

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

    });

  }

}


/* =========================================================
   ACTIVE NAVIGATION
========================================================= */

function setActiveNav(page) {

  if (dashboardNav) {
    dashboardNav.classList.toggle(
      "active",
      page === "dashboard"
    );
  }

  if (profileNav) {
    profileNav.classList.toggle(
      "active",
      page === "profile"
    );
  }

}


/* =========================================================
   DASHBOARD
========================================================= */

function showDashboard() {
  if (rejectionEditor.defer(showDashboard)) return;

  if (!currentMentor) return;

  const pendingCards =
    pendingRequests.length > 0
      ? pendingRequests.map((request) =>
          requestCardHtml(request)
        ).join("")
      : `
        <div class="center-state" style="padding:35px 15px;">
          Nobody's waiting on you right now.
        </div>
      `;


  const menteeCards =
    mentees.length > 0
      ? mentees.map((student) =>
          menteeCardHtml(student)
        ).join("")
      : `
        <div class="center-state" style="padding:25px;">
          No mentees found.
        </div>
      `;


  content.innerHTML = `

    <div class="card" style="margin-bottom:18px;">

      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:15px;
      ">

        <div>

          <p class="muted" style="margin:0 0 5px;">
            Welcome back
          </p>

          <h2 style="margin:0;">
            ${escapeHtml(currentMentor.name || "Mentor")}
          </h2>

          <p class="muted" style="margin:6px 0 0;">
            Mentor Dashboard
          </p>

        </div>

       <div id="mentorDashboardAvatar" style="
          width:52px;
          height:52px;
          border-radius:50%;
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:20px;
          font-weight:700;
          background:var(--surface-2, #f1f5f9);
        ">
          ${escapeHtml(getInitials(currentMentor.name))}
        </div>

      </div>

    </div>


    <div class="stat-grid" style="margin-bottom:18px;">

      <div class="stat-card">

        <div class="num">
          ${mentees.length}
        </div>

        <div class="label">
          My Mentees
        </div>

      </div>


      <div class="stat-card">

        <div class="num">
          ${pendingRequests.length}
        </div>

        <div class="label">
          Pending
        </div>

      </div>

    </div>


    <div class="banner" style="margin-bottom:18px;">

      Students appear for mentor approval only after completing
      all Stage 1 approvals — subject teachers, library and accounts.

    </div>


    <h2 style="margin:22px 0 12px;">
      Pending Approvals
    </h2>

    <div id="pendingRequestArea">

      ${pendingCards}

    </div>


    <h2 style="margin:28px 0 12px;">
      My Mentees
    </h2>

    <div class="list">

      ${menteeCards}

    </div>

    ${moreMentees ? '<button id="loadMoreMentees" class="btn-sm">Load more mentees</button>' : ''}

  `;

  wireRequestActions();
  const more = content.querySelector('#loadMoreMentees');
  if (more) more.onclick = () => { more.disabled = true; loadMentees(true); };

}


/* =========================================================
   REQUEST CARD
========================================================= */

function requestCardHtml(request) {
  const clearances=Object.entries(request.approvalItems||{}).map(([key,item])=>`<li>${escapeHtml(item.subjectCode ? item.subjectCode+' — '+item.label : item.label)}: ${escapeHtml(request.approvalStates?.[key]||'pending')}</li>`).join('');

  return `

    <div class="card"
         data-request-id="${escapeHtml(request.id)}"
         style="margin-bottom:14px;">

      <div style="
        display:flex;
        justify-content:space-between;
        gap:12px;
        align-items:flex-start;
      ">

        <div>

          <h3 style="margin:0 0 5px;">
            ${escapeHtml(request.studentName || "Student")}
          </h3>

          <p class="muted" style="margin:0;">
            ${escapeHtml(request.usn || "")}
            · Section ${escapeHtml(request.section || "")}
          </p>

        </div>

        <span class="badge">
          Stage 1 ✓
        </span>

      </div>


      <section aria-label="Stage 1 clearances"><h4>Mentor Approval</h4><p>All subject/service clearances completed.</p><ul>${clearances}</ul></section>
      <div class="reject-fields hidden"
           style="margin-top:15px;">

        <label>
          Reason for rejection
        </label>

        <textarea
          placeholder="Enter reason for rejection"
          rows="2">
        </textarea>

      </div>


      <div class="actions-right"
           style="margin-top:16px;">

        <button class="btn-reject btn-sm reject-btn">
          Reject
        </button>

        <button class="btn-approve btn-sm approve-btn">
          Approve
        </button>

      </div>

    </div>

  `;

}


/* =========================================================
   APPROVE / REJECT
========================================================= */

function wireRequestActions() {

  content
    .querySelectorAll(".approve-btn")
    .forEach((button) => {

      button.addEventListener("click", async (event) => {

        const card =
          event.target.closest("[data-request-id]");

        if (!card) return;

        button.disabled = true;

        try {

          await actAsMentor(
            card.dataset.requestId,
            "approved",
            ""
          );

        } catch (error) {

          console.error(error);

          alert(
            "Could not approve request: " +
            error.message
          );

          button.disabled = false;

        }

      });

    });


  rejectionEditor.bind('[data-request-id]', row => row.dataset.requestId + ':mentor:' + currentMentor.uid, (row, reason) => actAsMentor(row.dataset.requestId, 'rejected', reason));

}


/* =========================================================
   LISTEN FOR PENDING REQUESTS
========================================================= */

function listenForPendingRequests() {

  if (!currentMentor) return;


  const q = query(

    collection(db, "noDueRequests"),

    where(
      "mentorId",
      "==",
      currentMentor.uid
    ),

    where(
      "status",
      "==",
      STATUS.PENDING_MENTOR
    ), limit(100)

  );


  unsubscribeRequests = onSnapshot(

    q,

    (snapshot) => {

      pendingRequests =
        snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data()
        }));


      /*
        Refresh dashboard ONLY if mentor
        is currently on dashboard.

        Do NOT destroy Profile page.
      */

      if (
        window.location.hash !== "#profile"
      ) {

        showDashboard();

      }

    },

    (error) => {

      console.error(
        "Pending requests error:",
        error
      );

    }

  );

}


/* =========================================================
   LOAD MENTEES
========================================================= */

async function loadMentees(append = false) {

  if (!currentMentor || loadingMentees) return;
  loadingMentees = true;


  try {

    const page = await apiFetch('/api/academic/mentees?limit=30' + (append && menteeCursor ? '&cursor=' + encodeURIComponent(menteeCursor) : ''));
    menteeCursor = page.cursor;
    moreMentees = page.more;


    mentees = [...(append ? mentees : []), ...page.rows]
        .filter((student) => {

          /*
            If mentorId exists in student record,
            only show students assigned to this mentor.
          */

          if (student.mentorId) {

            return (
              student.mentorId ===
              currentMentor.uid
            );

          }

          /*
            Temporary fallback for your demo data.

            If CSV students don't yet contain mentorId,
            display them as mentees.
          */

          return false;

        });


    mentees.sort((a, b) =>
      String(a.name || "")
        .localeCompare(
          String(b.name || "")
        )
    );


    /*
      Refresh whatever screen is currently open.
    */

    if (
      window.location.hash === "#profile"
    ) {

      showProfile();

    } else {

      showDashboard();

    }

  } catch (error) {

    console.error(
      "Could not load mentees:",
      error
    );

    /*
      IMPORTANT:
      Don't break the whole dashboard if
      Firestore rules prevent students access.
    */

    if (!append) mentees = [];
    const more = content.querySelector('#loadMoreMentees');
    if (more) more.disabled = false;
  } finally {
    loadingMentees = false;

  }

}


/* =========================================================
   MENTEE CARD
========================================================= */

function menteeCardHtml(student) {

  const name =
    student.name ||
    student.student_name ||
    "Student";

  const usn =
    student.usn ||
    student.uid ||
    student.student_uid ||
    "—";

  const email =
    student.email ||
    student.mail ||
    student.mailId ||
    "—";

  const phone =
    student.phone ||
    student.phoneNumber ||
    "—";

  const semester =
    student.semester ||
    student.student_semester ||
    "—";

  const section =
    student.section ||
    student.student_section ||
    "—";


  return `

    <div class="card"
         style="margin-bottom:12px;">

      <div style="
        display:flex;
        align-items:center;
        gap:14px;
      ">

        <div style="
          width:46px;
          height:46px;
          border-radius:50%;
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight:700;
          flex-shrink:0;
          background:var(--surface-2, #f1f5f9);
        ">

          ${escapeHtml(getInitials(name))}

        </div>


        <div style="flex:1;">

          <h3 style="margin:0 0 4px;">
            ${escapeHtml(name)}
          </h3>

          <p class="muted"
             style="margin:0 0 3px;">

            ${escapeHtml(usn)}

          </p>

          <p class="muted"
             style="margin:0; font-size:13px;">

            Semester ${escapeHtml(semester)}
            · Section ${escapeHtml(section)}

          </p>

        </div>

      </div>


      <div style="
        border-top:1px solid var(--border, #e5e7eb);
        margin-top:14px;
        padding-top:12px;
        font-size:13px;
      ">

        <div style="margin-bottom:6px;">

          <span class="muted">
            Email:
          </span>

          ${escapeHtml(email)}

        </div>

        <div>

          <span class="muted">
            Phone:
          </span>

          ${escapeHtml(phone)}

        </div>

      </div>

    </div>

  `;

}


/* =========================================================
   PROFILE PAGE
========================================================= */

function showProfile() {

  if (!currentMentor) return;


  const mentorName =
    currentMentor.name ||
    "Mentor";


  const mentorEmail =
    currentMentor.email ||
    currentMentor.mail ||
    "Not available";


  content.innerHTML = `

    <div class="card"
         style="
           text-align:center;
           margin-bottom:18px;
           padding:28px 20px;
         ">


      <div id="mentorProfileAvatar"
           style="
             width:105px;
             height:105px;
             border-radius:50%;
             margin:0 auto 16px;
             display:flex;
             align-items:center;
             justify-content:center;
             overflow:hidden;
             font-size:32px;
             font-weight:700;
             border:3px solid var(--border, #ddd);
             background:var(--surface-2, #f1f5f9);
           ">

        ${escapeHtml(getInitials(mentorName))}

      </div>


      <h2 style="margin:0 0 5px;">

        ${escapeHtml(mentorName)}

      </h2>


      <p class="muted"
         style="margin:0 0 18px;">

        Mentor

      </p>



    </div>


    <div class="card"
         style="margin-bottom:18px;">

      <h2 style="margin-top:0;">
        Personal Details
      </h2>


      ${profileRow(
        "Name",
        mentorName
      )}


      ${profileRow(
        "Email",
        mentorEmail
      )}


      ${profileRow("Department", departmentLabel(currentMentor?.department) || "Not available")}

      ${profileRow(
        "Role",
        "Mentor"
      )}

    </div>


    <div class="card">

      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        margin-bottom:16px;
      ">

        <div>

          <h2 style="margin:0;">
            My Mentees
          </h2>

          <p class="muted"
             style="margin:4px 0 0;">

            ${mentees.length}
            student${mentees.length === 1 ? "" : "s"}

          </p>

        </div>

      </div>


      <div class="list">

        ${
          mentees.length

            ? mentees
                .map(
                  (student) =>
                    menteeCardHtml(student)
                )
                .join("")

            : `
              <div class="center-state"
                   style="padding:25px;">

                No mentees found.

              </div>
            `
        }

      </div>

    </div>

  `;



}


/* =========================================================
   PROFILE DETAIL ROW
========================================================= */

function profileRow(label, value) {

  return `

    <div style="
      display:flex;
      justify-content:space-between;
      gap:20px;
      padding:14px 0;
      border-bottom:1px solid var(--border, #e5e7eb);
    ">

      <span class="muted">

        ${escapeHtml(label)}

      </span>

      <strong style="text-align:right;">

        ${escapeHtml(value || "—")}

      </strong>

    </div>

  `;

}


/* =========================================================
   INITIALS
========================================================= */

function getInitials(name) {

  if (!name) return "M";


  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) =>
      word.charAt(0).toUpperCase()
    )
    .join("");

}


/* =========================================================
   SAFE HTML
========================================================= */

function escapeHtml(value) {

  const div =
    document.createElement("div");

  div.textContent =
    String(value ?? "");

  return div.innerHTML;

}
