import { db } from "./firebase-config.js";
import { requireAuth, wireLogout } from "./auth.js";
import { actOnStage1Item } from "./workflow.js";
import { initThemeToggle } from "./theme.js";
import {page as academicPage} from "./academic.js";

import {
  collection,
  query,
  where,
  onSnapshot, limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";


// ============================================================
// BASIC SETUP
// ============================================================

wireLogout();
initThemeToggle();

const content = document.getElementById("content");
const header = document.getElementById("approverHeader");

const dashboardNav = document.getElementById("dashboardNav");
const requestsNav = document.getElementById("requestsNav");
const profileNav = document.getElementById("profileNav");

let currentApprover = null;
let pendingDocs = [];
let unsubscribeApprovals = null;
let queueLimit = 30;
let taughtOfferings = new Set();


// ============================================================
// ROLE LABELS
// ============================================================

const ROLE_LABELS = {
  subject_faculty: "Subject faculty",
  library: "Library in-charge",
  physics_lab: "Physics lab in-charge",
  chemistry_lab: "Chemistry lab in-charge",
  accounts: "Accounts in-charge"
};


// ============================================================
// AUTHENTICATION
// ============================================================

requireAuth(["subject_faculty", "library", "physics_lab", "chemistry_lab", "accounts", "mentor"]).then(async (approver) => {

  currentApprover = approver;

  header.textContent =
    `${approver.name} · ${ROLE_LABELS[approver.role] || approver.role}` +
    `${approver.subjectCode ? " (" + approver.subjectCode + ")" : ""}`;

  if(["subject_faculty","mentor"].includes(approver.role)) {
    let cursor=null,more=true;
    while(more) {const result=await academicPage("offerings",[["teacherId","==",approver.uid]],cursor,50);result.rows.filter(o=>o.active!==false).forEach(o=>taughtOfferings.add(o.id));cursor=result.cursor;more=result.more;}
  }
  startApprovalListener(approver);
  setupNavigation();

}).catch(error => { content.textContent = error.message; });
window.addEventListener("pagehide", () => unsubscribeApprovals?.());


// ============================================================
// FIRESTORE APPROVAL LISTENER
// ============================================================

function startApprovalListener(approver) {
  unsubscribeApprovals?.();

  const clauses = [where("approverIds", "array-contains", approver.uid), where("status", "==", "pending_stage1"), limit(queueLimit)];

  const q = query(
    collection(db, "noDueRequests"),
    ...clauses
  );

  unsubscribeApprovals = onSnapshot(
    q,

    (snap) => {
      let button = document.getElementById("moreApprovals");
      if (!button) { button = document.createElement("button"); button.id="moreApprovals"; button.className="btn-sm"; button.textContent="Load more approval requests"; document.querySelector(".academic-links").append(button); button.onclick=()=>{queueLimit+=30;startApprovalListener(approver);}; }
      button.hidden = snap.size < queueLimit;

      pendingDocs = snap.docs.flatMap(request => {
        const r = request.data();
        return Object.entries(r.approvalItems || {}).filter(([id, item]) => item.approverId === approver.uid && r.approvalStates[id] === "pending"
          && ["subject_faculty","library","accounts"].includes(item.approverType)
          && (item.approverType!=="subject_faculty" || item.teacherUid===approver.uid && taughtOfferings.has(item.offeringId)))
          .map(([id, item]) => ({ id, ref: { path: `noDueRequests/${request.id}/approvals/${id}` }, data: () => ({ ...item, studentName: r.studentName, usn: r.usn, section: r.section }) }));
      });

      // Do not destroy profile page when Firestore updates.
      if (window.location.hash === "#profile") {
        return;
      }

      if (window.location.hash === "#requests") {
        showRequests();
        return;
      }

      showDashboard();
    },

    (err) => {

      console.error(err);

      content.innerHTML = `
        <div class="center-state">
          Couldn't load requests.
          <br><br>
          <span class="muted">
            ${escapeHtml(err.message)}
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

    dashboardNav.addEventListener("click", (event) => {

      event.preventDefault();

      window.history.replaceState(
        null,
        "",
        "approver-dashboard.html"
      );

      setActiveNav("dashboard");
      showDashboard();

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    });
  }


  if (requestsNav) {

    requestsNav.addEventListener("click", (event) => {

      event.preventDefault();

      window.history.replaceState(
        null,
        "",
        "#requests"
      );

      setActiveNav("requests");
      showRequests();

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


  // Direct URL navigation
  if (window.location.hash === "#profile") {

    setActiveNav("profile");
    showProfile();

  } else if (window.location.hash === "#requests") {

    setActiveNav("requests");
    showRequests();

  } else {

    setActiveNav("dashboard");
    showDashboard();
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

  if (requestsNav) {
    requestsNav.classList.toggle(
      "active",
      page === "requests"
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

  if (!currentApprover) return;

  setActiveNav("dashboard");

  const roleName =
    ROLE_LABELS[currentApprover.role] ||
    currentApprover.role ||
    "Approver";

  const initials =
    getInitials(currentApprover.name);


  content.innerHTML = `

    <div class="card">

      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:16px;
      ">

        <div>

          <p class="muted" style="margin:0 0 6px;">
            Welcome back
          </p>

          <h2 style="margin:0;">
            ${escapeHtml(currentApprover.name || "Approver")}
          </h2>

          <p class="muted" style="margin:6px 0 0;">
            ${escapeHtml(roleName)}
          </p>

          ${
            currentApprover.subjectCode
              ? `
                <p class="muted" style="margin:4px 0 0;">
                  Subject:
                  ${escapeHtml(currentApprover.subjectCode)}
                </p>
              `
              : ""
          }

        </div>


        <div
          class="approver-dashboard-avatar"
          style="
            width:58px;
            height:58px;
            border-radius:50%;
            display:flex;
            align-items:center;
            justify-content:center;
            font-size:21px;
            font-weight:700;
            background:#f1f5f9;
            color:#0f2747;
            border:3px solid #dfe4ea;
            flex-shrink:0;
          "
        >
          ${escapeHtml(initials)}
        </div>

      </div>

    </div>


    <div class="stat-grid">

      <div class="stat-card">

        <div class="num">
          ${pendingDocs.length}
        </div>

        <div class="label">
          Pending Requests
        </div>

      </div>


      <div class="stat-card">

        <div class="num">
          ${getShortRole(currentApprover.role)}
        </div>

        <div class="label">
          Department
        </div>

      </div>

    </div>


    <div class="card">

      <h2 style="margin-top:0;">
        Approval Desk
      </h2>

      <p class="muted">
        Requests requiring your approval will appear here.
      </p>

      ${
        pendingDocs.length === 0
          ? `
            <div
              class="center-state"
              style="padding:35px 10px;"
            >
              No pending approvals right now.
            </div>
          `
          : `
            <button
              type="button"
              id="openRequestsBtn"
              class="btn btn-primary btn-block"
            >
              View ${pendingDocs.length}
              Pending Request${pendingDocs.length === 1 ? "" : "s"}
            </button>
          `
      }

    </div>
  `;


  const openRequestsBtn =
    document.getElementById("openRequestsBtn");

  if (openRequestsBtn) {

    openRequestsBtn.addEventListener(
      "click",
      () => {

        window.history.replaceState(
          null,
          "",
          "#requests"
        );

        setActiveNav("requests");
        showRequests();
      }
    );
  }
}


// ============================================================
// REQUESTS PAGE
// ============================================================

function showRequests() {

  if (!currentApprover) return;

  setActiveNav("requests");


  if (pendingDocs.length === 0) {

    content.innerHTML = `

      <div class="card">

        <h2 style="margin-top:0;">
          Pending Requests
        </h2>

        <p class="muted">
          Student requests assigned to you appear here.
        </p>

      </div>


      <div class="center-state">
        No pending approvals right now.
      </div>
    `;

    return;
  }


  const rows = pendingDocs
    .map((docSnap) => rowHtml(docSnap))
    .join("");


  content.innerHTML = `

    <div class="card">

      <h2 style="margin-top:0;">
        Pending Requests
      </h2>

      <p class="muted">
        ${pendingDocs.length}
        request${pendingDocs.length === 1 ? "" : "s"}
        waiting for your action.
      </p>

    </div>


    <div class="list">
      ${rows}
    </div>
  `;


  wireRowActions(currentApprover);
}


// ============================================================
// PROFILE PAGE
// ============================================================

function showProfile() {

  if (!currentApprover) return;

  setActiveNav("profile");


  const name =
    currentApprover.name || "Approver";

  const email =
    currentApprover.email || "Not available";

  const role =
    ROLE_LABELS[currentApprover.role] ||
    currentApprover.role ||
    "Approver";

  const initials =
    getInitials(name);


  content.innerHTML = `

    <div
      class="card"
      style="
        text-align:center;
        padding:34px 24px;
      "
    >

      <div
        class="approver-profile-avatar"
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
        ${escapeHtml(role)}
      </p>

    </div>


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
        role
      )}


      ${
        currentApprover.subjectCode
          ? detailRow(
              "Subject Code",
              currentApprover.subjectCode
            )
          : ""
      }


      ${detailRow(
        "Pending approvals",
        String(pendingDocs.length)
      )}

    </div>
  `;
}


// ============================================================
// DETAIL ROW
// ============================================================

function detailRow(label, value) {

  return `

    <div style="
      display:flex;
      justify-content:space-between;
      gap:20px;
      padding:15px 0;
      border-bottom:1px solid var(--border);
    ">

      <span class="muted">
        ${escapeHtml(label)}
      </span>


      <strong style="
        text-align:right;
        overflow-wrap:anywhere;
      ">
        ${escapeHtml(value)}
      </strong>

    </div>
  `;
}


// ============================================================
// REQUEST ROW
// ============================================================

function rowHtml(docSnap) {

  const data = docSnap.data();

  return `

    <div
      class="row"
      data-path="${docSnap.ref.path}"
    >

      <div>

        <div class="row-label">
          ${escapeHtml(
            data.studentName || "Student"
          )}
        </div>


        <div class="row-sub">

          ${escapeHtml(data.usn || "")}

          ${
            data.section
              ? " · Sec " +
                escapeHtml(data.section)
              : ""
          }

        </div>


        <div class="row-sub">
          ${escapeHtml(data.label || "")}
        </div>

      </div>


      <div class="actions-right">

        <button
          class="btn-sm btn-approve approve-btn"
        >
          Approve
        </button>


        <button
          class="btn-sm btn-reject reject-btn"
        >
          Reject
        </button>

      </div>

    </div>
  `;
}


// ============================================================
// APPROVE / REJECT
// FIXED TO MATCH CURRENT workflow.js
// ============================================================

function wireRowActions(approver) {

  // ----------------------------
  // APPROVE
  // ----------------------------

  document
    .querySelectorAll(".approve-btn")
    .forEach((button) => {

      button.addEventListener(
        "click",
        async () => {

          const row =
            button.closest(".row");

          if (!row) {
            return;
          }

          const path =
            row.dataset.path;

          if (!path) {

            console.error(
              "Approval path missing."
            );

            alert(
              "Could not find this approval."
            );

            return;
          }


          // Expected:
          // noDueRequests/REQUEST_ID/approvals/APPROVAL_ID

          const parts =
            path.split("/");


          if (
            parts.length < 4 ||
            parts[0] !== "noDueRequests" ||
            parts[2] !== "approvals"
          ) {

            console.error(
              "Invalid approval path:",
              path
            );

            alert(
              "Invalid approval path."
            );

            return;
          }


          const requestId =
            parts[1];

          const approvalId =
            parts[3];


          try {

            button.disabled = true;
            button.textContent =
              "Approving...";


            await actOnStage1Item(
              requestId,
              approvalId,
              "approved",
              "",
              approver.name ||
                approver.email ||
                "Approver"
            );


            // Firestore onSnapshot()
            // automatically refreshes pendingDocs/UI.

          }

          catch (error) {

            console.error(
              "Approval error:",
              error
            );


            alert(
              "Could not approve request: " +
              error.message
            );


            button.disabled = false;

            button.textContent =
              "Approve";
          }
        }
      );
    });


  // ----------------------------
  // REJECT
  // ----------------------------

  document
    .querySelectorAll(".reject-btn")
    .forEach((button) => {

      button.addEventListener(
        "click",
        async () => {

          const row =
            button.closest(".row");

          if (!row) {
            return;
          }


          const path =
            row.dataset.path;


          if (!path) {

            console.error(
              "Approval path missing."
            );

            alert(
              "Could not find this approval."
            );

            return;
          }


          // Expected:
          // noDueRequests/REQUEST_ID/approvals/APPROVAL_ID

          const parts =
            path.split("/");


          if (
            parts.length < 4 ||
            parts[0] !== "noDueRequests" ||
            parts[2] !== "approvals"
          ) {

            console.error(
              "Invalid approval path:",
              path
            );

            alert(
              "Invalid approval path."
            );

            return;
          }


          const requestId =
            parts[1];

          const approvalId =
            parts[3];


          let reasonInput = row.querySelector("textarea");
          if (!reasonInput) {
            row.style.flexWrap = "wrap";
            reasonInput = document.createElement("textarea");
            reasonInput.placeholder = "Enter reason for rejection";
            reasonInput.setAttribute("aria-label", "Reason for rejection");
            reasonInput.maxLength = 2000;
            reasonInput.style.width = "100%";
            row.append(reasonInput);
            button.textContent = "Confirm rejection";
            reasonInput.focus();
            return;
          }
          const remarks = reasonInput.value;


          if (!remarks.trim()) {

            alert(
              "Please enter a reason for rejection."
            );

            return;
          }


          try {

            button.disabled = true;

            button.textContent =
              "Rejecting...";


            await actOnStage1Item(
              requestId,
              approvalId,
              "rejected",
              remarks.trim(),
              approver.name ||
                approver.email ||
                "Approver"
            );


            // Firestore listener refreshes UI.

          }

          catch (error) {

            console.error(
              "Rejection error:",
              error
            );


            alert(
              "Could not reject request: " +
              error.message
            );


            button.disabled = false;

            button.textContent =
              "Reject";
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
    return "A";
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
// SHORT ROLE
// ============================================================

function getShortRole(role) {

  const names = {

    library: "Library",

    physics_lab: "Physics",

    chemistry_lab: "Chemistry",

    accounts: "Accounts",

    subject_faculty: "Faculty"
  };

  return names[role] || "Staff";
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
