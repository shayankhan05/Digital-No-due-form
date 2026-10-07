import { db } from "./firebase-config.js";
import { requireAuth, wireLogout } from "./auth.js";
import { actAsHod, STATUS } from "./workflow.js";
import { initThemeToggle } from "./theme.js";

import {
  collection,
  query,
  where,
  onSnapshot, limit
} from "./api-store.js";


// ============================================================
// BASIC SETUP
// ============================================================

wireLogout();
initThemeToggle();

const content =
  document.getElementById("content");

const header =
  document.getElementById("hodHeader");

const dashboardNav =
  document.getElementById("hodDashboardNav");

const profileNav =
  document.getElementById("hodProfileNav");


let currentHod = null;
let pendingDocs = [];
let unsubscribeRequests;
window.addEventListener("pagehide", () => unsubscribeRequests?.());


// ============================================================
// AUTH + START DASHBOARD
// ============================================================

requireAuth(["hod"]).then((hod) => {

  currentHod = hod;

  header.textContent =
    `${hod.name || "HOD"} · HOD`;

  setupNavigation();

  startHodListener();

}).catch(error => { content.textContent = error.message; });


// ============================================================
// FIRESTORE LISTENER
// ============================================================

function startHodListener() {

  const q = query(

    collection(db, "noDueRequests"), where("hodId", "==", currentHod.uid), limit(30),

    where(
      "status",
      "==",
      STATUS.PENDING_HOD
    )

  );


  unsubscribeRequests = onSnapshot(

    q,

    (snap) => {

      pendingDocs = snap.docs;


      // Don't destroy profile if Firestore updates
      if (window.location.hash === "#profile") {
        return;
      }


      showDashboard();

    },

    (error) => {

      console.error(error);

      content.innerHTML = `

        <div class="center-state">

          Couldn't load final approvals.

          <br><br>

          <span class="muted">
            ${escapeHtml(error.message)}
          </span>

        </div>

      `;

    }

  );

}


// ============================================================
// NAVIGATION
// ============================================================

function setupNavigation() {

  if (dashboardNav) {

    dashboardNav.addEventListener(
      "click",
      (event) => {

        event.preventDefault();

        window.history.replaceState(
          null,
          "",
          "hod-dashboard.html"
        );

        setActiveNav("dashboard");

        showDashboard();

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


  // Page opened directly on #profile
  if (window.location.hash === "#profile") {

    setActiveNav("profile");
    showProfile();

  }

  else {

    setActiveNav("dashboard");

  }

}


// ============================================================
// ACTIVE NAVIGATION
// ============================================================

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


// ============================================================
// DASHBOARD
// ============================================================

function showDashboard() {

  if (!currentHod) return;

  setActiveNav("dashboard");


  const banner = `

    <div class="banner">

      Only students who have cleared all subjects,
      departments, and mentor review appear here.

    </div>

  `;


  // NO REQUESTS
  if (pendingDocs.length === 0) {

    content.innerHTML = `

      ${banner}

      <div class="center-state">

        Nothing waiting on final approval right now.

      </div>

    `;

    return;

  }


  // REQUESTS AVAILABLE
  const rows = pendingDocs

    .map((docSnap) =>
      rowHtml(docSnap)
    )

    .join("");


  content.innerHTML = `

    ${banner}

    <div class="list">

      ${rows}

    </div>

  `;


  wireActions();

}


// ============================================================
// HOD PROFILE
// ============================================================

function showProfile() {

  if (!currentHod) return;

  setActiveNav("profile");


  const name =
    currentHod.name || "HOD";

  const email =
    currentHod.email || "Not available";

  const initials =
    getInitials(name);


  content.innerHTML = `

    <!-- PROFILE CARD -->

    <div
      class="card"
      style="
        text-align:center;
        padding:36px 24px;
      "
    >


      <div
        class="hod-profile-avatar"
        style="
          width:110px;
          height:110px;
          border-radius:50%;
          margin:0 auto 20px;
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:36px;
          font-weight:700;
          background:#f1f5f9;
          color:#0f2747;
          border:4px solid #dfe4ea;
        "
      >

        ${escapeHtml(initials)}

      </div>


      <h2
        style="
          margin:0 0 6px;
          font-size:27px;
        "
      >

        ${escapeHtml(name)}

      </h2>


      <p
        class="muted"
        style="
          margin:0;
          font-size:16px;
        "
      >

        Head of Department

      </p>

    </div>



    <!-- PERSONAL DETAILS -->

    <div class="card">

      <h2 style="margin-top:0;">
        Personal Details
      </h2>


      ${detailRow(
        "Name",
        name
      )}


      ${detailRow(
        "Email",
        email
      )}


      ${detailRow(
        "Role",
        "Head of Department"
      )}


      ${detailRow(
        "Pending final approvals",
        String(pendingDocs.length)
      )}

    </div>

  `;

}


// ============================================================
// PROFILE DETAIL ROW
// ============================================================

function detailRow(label, value) {

  return `

    <div
      style="
        display:flex;
        justify-content:space-between;
        gap:20px;
        padding:15px 0;
        border-bottom:1px solid var(--border);
      "
    >

      <span class="muted">

        ${escapeHtml(label)}

      </span>


      <strong
        style="
          text-align:right;
          overflow-wrap:anywhere;
        "
      >

        ${escapeHtml(value)}

      </strong>

    </div>

  `;

}


// ============================================================
// REQUEST ROW
// ============================================================

function rowHtml(docSnap) {

  const r =
    docSnap.data();


  return `

    <div
      class="row"
      data-request-id="${docSnap.id}"
      style="flex-wrap:wrap;"
    >


      <div>

        <div class="row-label">

          ${escapeHtml(
            r.studentName || "Student"
          )}

        </div>


        <div class="row-sub">

          ${escapeHtml(r.usn || "")}

          ${
            r.section
              ? " · Sec " +
                escapeHtml(r.section)
              : ""
          }

        </div>

      </div>



      <span class="badge badge-approved">

        Stage 1 + mentor cleared

      </span>



      <div
        class="actions-right"
        style="
          width:100%;
          margin-top:8px;
        "
      >

        <button
          class="btn-reject btn-sm reject-btn"
        >

          Reject

        </button>


        <button
          class="btn-approve btn-sm approve-btn"
        >

          Approve

        </button>

      </div>



      <div
        class="reject-fields hidden"
        style="
          width:100%;
          margin-top:8px;
        "
      >

        <label>
          Reason for rejection
        </label>


        <textarea
          placeholder="Provide detailed feedback for the student"
          rows="2">
        </textarea>

      </div>

    </div>

  `;

}


// ============================================================
// APPROVE / REJECT
// EXISTING WORKING HOD WORKFLOW PRESERVED
// ============================================================

function wireActions() {


  // APPROVE
  content
    .querySelectorAll(".approve-btn")
    .forEach((btn) => {


      btn.addEventListener(
        "click",

        async (event) => {


          const row =
            event.target.closest(".row");


          if (!row) return;


          btn.disabled = true;


          try {

            await actAsHod(
              row.dataset.requestId,
              "approved",
              ""
            );

          }

          catch (error) {

            console.error(error);

            alert(
              "Could not approve request: " +
              error.message
            );

            btn.disabled = false;

          }

        }

      );

    });



  // REJECT
  content
    .querySelectorAll(".reject-btn")
    .forEach((btn) => {


      btn.addEventListener(
        "click",

        async (event) => {


          const row =
            event.target.closest(".row");


          if (!row) return;


          const fields =
            row.querySelector(
              ".reject-fields"
            );


          // First click = show reason box
          if (
            fields.classList.contains(
              "hidden"
            )
          ) {

            fields.classList.remove(
              "hidden"
            );

            btn.textContent =
              "Confirm rejection";

            return;

          }


          const textarea =
            fields.querySelector(
              "textarea"
            );


          const reason =
            textarea.value.trim();


          if (!reason) {

            alert(
              "A reason is required."
            );

            return;

          }


          btn.disabled = true;


          try {

            await actAsHod(
              row.dataset.requestId,
              "rejected",
              reason
            );

          }

          catch (error) {

            console.error(error);

            alert(
              "Could not reject request: " +
              error.message
            );

            btn.disabled = false;

          }

        }

      );

    });

}


// ============================================================
// INITIALS
// ============================================================

function getInitials(name) {

  if (!name) {
    return "HD";
  }


  return String(name)

    .trim()

    .split(/\s+/)

    .slice(0, 2)

    .map(
      word =>
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
