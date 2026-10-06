import { db, auth } from "./firebase-config.js";
import { requireAuth, wireLogout } from "./auth.js";
import { initThemeToggle } from "./theme.js";
import { studentProfile, academicDetails, academicHTML } from "./academic.js";
import { notificationHTML, loadNotifications, approvalHTML } from "./student-updates.js";

import {
  collection,
  query,
  where,
  getDocs, orderBy, limit, startAfter
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import {
  getRequiredApprovers,
  statusLabel,
  resubmit
} from "./workflow.js";


/* =========================================================
   INITIAL SETUP
========================================================= */

wireLogout();
initThemeToggle();

const content = document.getElementById("content");

let currentStudent = null;
let studentRequests = [];
let requiredApprovers = [];
let requestCursor = null;
let moreRequests = false;

let PROFILE_PHOTO_KEY = "digitalNoDueStudentPhoto";


/* =========================================================
   AUTHENTICATION
========================================================= */

requireAuth()
  .then(async (student) => {

    if (student.role !== "student") {
      window.location.href = "login.html";
      return;
    }

    currentStudent = await studentProfile(student.uid, student);
    PROFILE_PHOTO_KEY = `digitalNoDueStudentPhoto:${student.uid}`;
    try { requiredApprovers = await getRequiredApprovers(student.uid); } catch { requiredApprovers = []; }

    await loadRequests();

    setupNavigation();

    // Open profile automatically if URL contains #profile
    if (window.location.hash === "#profile") {
      setActiveNav(3);
      showProfile();
    } else if (window.location.hash === "#requests") {
      setActiveNav(1); showRequests();
    } else {
      setActiveNav(0);
      showDashboard();
    }

  })
  .catch((error) => {

    console.error("Student dashboard error:", error);

    content.innerHTML = `
      <div class="center-state">
        Couldn't load your dashboard.
        <br><br>
        <span class="muted">
          ${escapeHtml(error.message)}
        </span>
      </div>
    `;
  });


/* =========================================================
   LOAD REQUESTS
========================================================= */

async function loadRequests(append = false) {

  const q = query(
    collection(db, "noDueRequests"),
    where("studentId", "==", currentStudent.uid), orderBy("createdAt", "desc"),
    ...(append && requestCursor ? [startAfter(requestCursor)] : []), limit(20)
  );

  const snapshot = await getDocs(q);

  requestCursor = snapshot.docs.at(-1);
  moreRequests = snapshot.size === 20;
  const rows = snapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data()
  }));
  studentRequests = append ? [...studentRequests, ...rows] : rows;

  studentRequests.sort((a, b) => {
    const aTime = a.createdAt?.seconds || 0;
    const bTime = b.createdAt?.seconds || 0;

    return bTime - aTime;
  });
}


/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {

  const links = document.querySelectorAll(".bottom-nav a");

  const dashboardNav = links[0];
  const requestsNav = links[1];
  const profileNav = document.getElementById("profileNav");

  // DASHBOARD
  if (dashboardNav) {

    dashboardNav.addEventListener("click", (event) => {

      event.preventDefault();

      setActiveNav(0);
      showDashboard();

      window.history.replaceState(
        null,
        "",
        "student-dashboard.html"
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    });
  }


  // REQUESTS
  if (requestsNav) {

    requestsNav.addEventListener("click", (event) => {

      event.preventDefault();

      setActiveNav(1);
      showRequests();

      window.history.replaceState(
        null,
        "",
        "student-dashboard.html#requests"
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    });
  }


  // PROFILE
  if (profileNav) {

    profileNav.addEventListener("click", (event) => {

      event.preventDefault();

      setActiveNav(3);
      showProfile();

      window.history.replaceState(
        null,
        "",
        "#profile"
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    });
  }
}


function setActiveNav(index) {

  const links =
    document.querySelectorAll(".bottom-nav a");

  links.forEach(link =>
    link.classList.remove("active")
  );

  if (links[index]) {
    links[index].classList.add("active");
  }
}


/* =========================================================
   DASHBOARD
========================================================= */

function showDashboard() {

  const student = currentStudent;

  const subjects =
    requiredApprovers.filter(
      item => item.type === "subject_faculty"
    );

  const latestRequest =
    studentRequests.length
      ? studentRequests[0]
      : null;

  const photo =
    localStorage.getItem(PROFILE_PHOTO_KEY);


  content.innerHTML = `

    <div class="card profile-summary-card">

      <div class="student-welcome">

        <div class="profile-avatar">

          ${
            photo
              ? `<img src="${photo}" alt="Profile photo">`
              : escapeHtml(getInitials(student.name))
          }

        </div>

        <div class="student-welcome-text">

          <p>Welcome back</p>

          <h2>
            ${escapeHtml(student.name || "Student")}
          </h2>

          <p>
            ${escapeHtml(student.usn || "")}
          </p>

        </div>

      </div>


      <div class="student-meta-grid">

        <div class="student-meta-item">
          <span>Semester</span>
          <strong>
            ${escapeHtml(student.semester || "-")}
          </strong>
        </div>

        <div class="student-meta-item">
          <span>Section</span>
          <strong>
            ${escapeHtml(student.section || "-")}
          </strong>
        </div>

        <div class="student-meta-item">
          <span>Scheme</span>
          <strong>
            ${escapeHtml(student.scheme || "2022")}
          </strong>
        </div>

        <div class="student-meta-item">
          <span>Status</span>
          <strong>
            ${
              latestRequest
                ? escapeHtml(statusLabel(latestRequest.status))
                : "Not submitted"
            }
          </strong>
        </div>

      </div>

    </div>


    <div class="card">

      <div class="modern-section-title">

        <h2>My Subjects & Teachers</h2>

        <span>
          ${subjects.length} subjects
        </span>

      </div>


      <div class="subject-grid">

        ${
          subjects.length
            ? subjects.map(subject => `

              <div class="subject-item">

                <div class="subject-icon">
                  ${escapeHtml(subject.subjectCode || "SUB")}
                </div>

                <div class="subject-info">

                  <strong>
                    ${escapeHtml(subject.label)}
                  </strong>

                  <span>
                    ${escapeHtml(subject.subjectCode || "")}
                  </span>
                  <span>Teacher: ${escapeHtml(subject.teacherName || "Not linked")}</span>
                  <span>${escapeHtml(subject.teacherEmail || "")}</span>
                  <span>Semester ${escapeHtml(subject.semester || student.semester)} · Section ${escapeHtml(subject.section || student.section)}</span>

                </div>

              </div>

            `).join("")
            : `
              <div class="center-state">
                No subjects configured.
              </div>
            `
        }

      </div>

    </div>


    <div class="card">

      <div class="modern-section-title">

        <h2>No-Due Progress</h2>

        <span>
          Current request
        </span>

      </div>

      ${
        latestRequest
          ? requestStatusHTML(latestRequest)
          : noRequestHTML()
      }

    </div>
  `;

  wireResubmit(latestRequest);
  const refresh = document.createElement("button"); refresh.textContent = "Refresh status & notifications"; refresh.className = "btn-sm";
  refresh.onclick = async () => { refresh.disabled = true; try {
    currentStudent = await studentProfile(currentStudent.uid, currentStudent);
    requiredApprovers = await getRequiredApprovers(currentStudent.uid);
    await loadRequests(); showDashboard();
  } catch(error) { alert(error.message); refresh.disabled=false; } };
  content.append(refresh);
  const updates = document.createElement("div");
  content.append(updates);
  loadNotifications(currentStudent.uid).then(rows => { updates.innerHTML = notificationHTML(rows); }).catch(error => { updates.textContent = error.message; });
}


/* =========================================================
   REQUESTS VIEW
========================================================= */

function showRequests() {

  if (!studentRequests.length) {

    content.innerHTML = `

      <div class="card">

        <div class="modern-section-title">
          <h2>My Requests</h2>
        </div>

        ${noRequestHTML()}

      </div>
    `;

    return;
  }


  content.innerHTML = `

    <div class="card">

      <div class="modern-section-title">

        <h2>My Requests</h2>

        <span>
          ${studentRequests.length}
          ${studentRequests.length === 1 ? "request" : "requests"}
        </span>

      </div>


      <div class="list">

        ${
          studentRequests.map(request => `

            <div class="row">

              <div>

                <div class="row-label">
                  <strong>
                    No-Due Request
                  </strong>
                </div>

                <div class="row-sub">
                  ${escapeHtml(request.id)}
                </div>

              </div>

              <span class="${getStatusBadge(request.status)}">

                ${escapeHtml(
                  statusLabel(request.status)
                )}

              </span>

            </div>

          `).join("")
        }

      </div>

    </div>


    <div class="card">

      <div class="modern-section-title">
        <h2>Latest Request</h2>
      </div>

      ${requestStatusHTML(studentRequests[0])}

    </div>
  `;

  wireResubmit(studentRequests[0]);
  if (moreRequests) {
    const button = document.createElement("button"); button.textContent = "Load older requests"; button.className = "btn-sm";
    button.onclick = async () => { button.disabled = true; try { await loadRequests(true); showRequests(); } catch (error) { alert(error.message); button.disabled = false; } };
    content.append(button);
  }
}


/* =========================================================
   PROFILE VIEW
========================================================= */

function showProfile() {

  const student = currentStudent;

  const photo =
    localStorage.getItem(PROFILE_PHOTO_KEY);

  const email =
    student.email ||
    auth.currentUser?.email ||
    "Not available";


  content.innerHTML = `

    <div class="profile-page">

      <div class="card profile-hero">

        <div
          class="profile-photo-large"
          id="profilePhotoDisplay">

          ${
            photo
              ? `<img src="${photo}" alt="Profile photo">`
              : escapeHtml(getInitials(student.name))
          }

        </div>


        <h2>
          ${escapeHtml(student.name || "Student")}
        </h2>

        <p class="profile-email">
          ${escapeHtml(email)}
        </p>


        <div class="photo-actions">

          <button
            type="button"
            class="photo-upload"
            id="uploadPhotoBtn">
            Upload Photo
          </button>

          <button
            type="button"
            class="photo-remove"
            id="removePhotoBtn">
            Remove Photo
          </button>

        </div>


        <input
          type="file"
          id="profilePhotoInput"
          accept="image/png,image/jpeg,image/webp"
          hidden
        >

      </div>


      <div class="card profile-details">

        <div class="modern-section-title">
          <h2>Student Information</h2>
        </div>


        <div class="profile-info-row">
          <span class="profile-info-label">
            Full Name
          </span>

          <span class="profile-info-value">
            ${escapeHtml(student.name || "-")}
          </span>
        </div>


        <div class="profile-info-row">
          <span class="profile-info-label">
            USN
          </span>

          <span class="profile-info-value">
            ${escapeHtml(student.usn || "-")}
          </span>
        </div>


        <div class="profile-info-row">
          <span class="profile-info-label">
            Semester
          </span>

          <span class="profile-info-value">
            ${escapeHtml(student.semester || "-")}
          </span>
        </div>


        <div class="profile-info-row">
          <span class="profile-info-label">
            Section
          </span>

          <span class="profile-info-value">
            ${escapeHtml(student.section || "-")}
          </span>
        </div>


        <div class="profile-info-row">
          <span class="profile-info-label">
            Scheme
          </span>

          <span class="profile-info-value">
            ${escapeHtml(student.scheme || "2022")}
          </span>
        </div>


        <div class="profile-info-row">
          <span class="profile-info-label">
            Email
          </span>

          <span class="profile-info-value">
            ${escapeHtml(email)}
          </span>
        </div>

      </div>

    </div>
  `;


  setupPhotoControls();
  const academic = document.createElement("div");
  academic.innerHTML = '<div class="card">Loading academic information…</div>';
  content.append(academic);
  academicDetails(currentStudent.uid).then(details => { academic.innerHTML = academicHTML(details); }).catch(error => { academic.textContent = error.message; });
}


/* =========================================================
   PROFILE PHOTO
========================================================= */

function setupPhotoControls() {

  const input =
    document.getElementById("profilePhotoInput");

  const uploadButton =
    document.getElementById("uploadPhotoBtn");

  const removeButton =
    document.getElementById("removePhotoBtn");


  if (!input || !uploadButton || !removeButton) {
    return;
  }


  uploadButton.addEventListener("click", () => {
    input.click();
  });


  input.addEventListener("change", () => {

    const file = input.files[0];

    if (!file) return;


    if (!file.type.startsWith("image/")) {

      alert("Please select an image file.");

      input.value = "";

      return;
    }


    if (file.size > 2 * 1024 * 1024) {

      alert(
        "Please choose an image smaller than 2 MB."
      );

      input.value = "";

      return;
    }


    const reader = new FileReader();


    reader.onload = () => {

      try {

        localStorage.setItem(
          PROFILE_PHOTO_KEY,
          reader.result
        );

        showProfile();

      } catch (error) {

        console.error(error);

        alert(
          "This image is too large to save. Please choose a smaller photo."
        );
      }
    };


    reader.readAsDataURL(file);
  });


  removeButton.addEventListener("click", () => {

    localStorage.removeItem(
      PROFILE_PHOTO_KEY
    );

    showProfile();
  });
}


/* =========================================================
   REQUEST STATUS
========================================================= */

function requestStatusHTML(request) {

  let message = "";


  switch (request.status) {

    case "pending_stage1":

      message =
        "Waiting for your subject teachers, library and accounts approvals.";

      break;


    case "pending_mentor":

      message =
        "Stage 1 is complete. Your request is currently with your mentor.";

      break;


    case "pending_hod":

      message =
        "Mentor approved. Your request is currently with the coordinator / HOD.";

      break;


    case "cleared":

      message =
        "All approvals are complete. Your request is ready for office processing.";

      break;


    case "issued":

      message =
        "Your hall ticket has been issued.";

      break;


    case "rejected":

      message =
        "An authority rejected this request. Resolve the issue and resubmit it.";

      break;


    default:

      message =
        "Your request is currently being processed.";
  }


  return `

    <div class="banner">

      <strong>
        ${escapeHtml(
          statusLabel(request.status)
        )}
      </strong>

      <br><br>

      ${escapeHtml(message)}

    </div>


    ${approvalHTML(request)}
    <p class="muted">

      Request ID:
      ${escapeHtml(request.id)}

    </p>


    ${
      request.status === "rejected"
        ? `

          <button
            id="resubmitBtn"
            class="btn btn-primary btn-block">

            Resubmit Request

          </button>

        `
        : ""
    }
  `;
}


/* =========================================================
   NO REQUEST
========================================================= */

function noRequestHTML() {

  return `

    <div class="center-state">

      No No-Due request has been submitted yet.

      <br><br>

      <a
        href="create-request.html"
        class="btn btn-primary">

        Create No-Due Request

      </a>

    </div>
  `;
}


/* =========================================================
   RESUBMIT
========================================================= */

function wireResubmit(request) {

  const button =
    document.getElementById("resubmitBtn");

  if (!button || !request) return;


  button.addEventListener("click", async () => {

    try {

      button.disabled = true;

      button.textContent =
        "Resubmitting...";


      await resubmit(request.id);

      await loadRequests();

      showDashboard();

      setActiveNav(0);


    } catch (error) {

      console.error(error);

      alert(
        "Could not resubmit request: " +
        error.message
      );


      button.disabled = false;

      button.textContent =
        "Resubmit Request";
    }
  });
}


/* =========================================================
   STATUS BADGE
========================================================= */

function getStatusBadge(status) {

  switch (status) {

    case "issued":
    case "cleared":

      return "badge badge-approved";


    case "rejected":

      return "badge badge-rejected";


    default:

      return "badge badge-pending";
  }
}


/* =========================================================
   INITIALS
========================================================= */

function getInitials(name) {

  if (!name) return "ST";

  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word.charAt(0).toUpperCase())
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
