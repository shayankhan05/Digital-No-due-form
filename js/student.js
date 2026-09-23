import { db } from "./firebase-config.js";
import { requireAuth, wireLogout } from "./auth.js";
import { resubmit, statusLabel, STATUS } from "./workflow.js";
import {
  collection, query, where, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

wireLogout();
const content = document.getElementById("content");

requireAuth().then((student) => {
  const q = query(
    collection(db, "noDueRequests"),
    where("studentId", "==", student.uid)
  );

  onSnapshot(q, (snap) => {
    if (snap.empty) {
      renderNoRequest(student);
      return;
    }
    // Most recent request (sorted client-side — avoids needing a composite index for a demo).
    const requests = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    renderRequest(student, requests[0]);
  }, (err) => {
    content.innerHTML = `<div class="center-state">Couldn't load your request.<br><span class="muted">${err.message}</span></div>`;
  });
});

function renderNoRequest(student) {
  content.innerHTML = `
    <div class="card">
      <p class="row-label" style="margin:0 0 4px;">${student.name}</p>
      <p class="muted" style="margin:0;">${student.usn} · Sem ${student.semester}, Sec ${student.section}</p>
    </div>
    <div class="center-state">
      <p>You haven't applied for No-Due clearance yet.</p>
      <a href="create-request.html" class="btn btn-primary" style="display:inline-block; text-decoration:none; margin-top:8px;">Apply now</a>
    </div>
  `;
}

function renderRequest(student, request) {
  // Stage 1 checklist items live in a subcollection — listen to them too.
  const approvalsRef = collection(db, "noDueRequests", request.id, "approvals");

  onSnapshot(approvalsRef, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    draw(student, request, items);
  });
}

function draw(student, request, items) {
  const approvedCount = items.filter((i) => i.status === "approved").length
    + (request.mentorApproval?.status === "approved" ? 1 : 0)
    + (request.hodApproval?.status === "approved" ? 1 : 0);
  const rejectedCount = items.filter((i) => i.status === "rejected").length
    + (request.mentorApproval?.status === "rejected" ? 1 : 0)
    + (request.hodApproval?.status === "rejected" ? 1 : 0);
  const totalCount = items.length + 2; // + mentor + hod
  const pendingCount = totalCount - approvedCount - rejectedCount;
  const pct = Math.round((approvedCount / totalCount) * 100);

  const stage1Rows = items.map((i) => rowHtml(i.label || i.approverType, i.status)).join("");
  const mentorRow = rowHtml("Soft skill (mentor)", request.mentorApproval?.status || "pending");
  const hodRow = rowHtml("Coordinator / HOD sign-off", request.hodApproval?.status || "pending");

  const rejectedReasons = [
    ...items.filter((i) => i.status === "rejected").map((i) => `${i.label || i.approverType}: ${i.remarks || "No reason given"}`),
    request.mentorApproval?.status === "rejected" ? `Mentor: ${request.mentorApproval.remarks || "No reason given"}` : null,
    request.hodApproval?.status === "rejected" ? `Coordinator: ${request.hodApproval.remarks || "No reason given"}` : null,
  ].filter(Boolean);

  content.innerHTML = `
    <div class="card">
      <p class="row-label" style="margin:0 0 4px;">${student.name}</p>
      <p class="muted" style="margin:0;">${student.usn} · Sem ${student.semester}, Sec ${student.section}</p>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="num">${totalCount}</div><div class="label">Total</div></div>
      <div class="stat-card"><div class="num" style="color:var(--green-text)">${approvedCount}</div><div class="label">Approved</div></div>
      <div class="stat-card"><div class="num" style="color:var(--orange-text)">${pendingCount}</div><div class="label">Pending</div></div>
      <div class="stat-card"><div class="num" style="color:var(--red-text)">${rejectedCount}</div><div class="label">Rejected</div></div>
    </div>

    <div class="card">
      <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
        <span>${statusLabel(request.status)}</span><span>${approvedCount}/${totalCount}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>

      ${request.status === "rejected" ? `
        <div class="reject-box" style="margin-top:12px;">
          <p style="margin:0 0 6px; font-size:13px; font-weight:500; color:var(--red-text);">Rejected — here's why</p>
          <ul style="margin:0 0 10px; padding-left:18px; font-size:13px;">
            ${rejectedReasons.map((r) => `<li>${r}</li>`).join("")}
          </ul>
          <button id="resubmitBtn" class="btn-primary btn-block">Resubmit</button>
        </div>
      ` : ""}

      ${request.status === "issued" ? `<p class="muted" style="margin:8px 0 0;">Hall ticket issued ✓</p>` : ""}
    </div>

    <p class="section-label">Stage 1 — departments</p>
    <div class="list">${stage1Rows}</div>

    <p class="section-label">Stage 2 &amp; 3</p>
    <div class="list">${mentorRow}${hodRow}</div>
  `;

  const resubmitBtn = document.getElementById("resubmitBtn");
  if (resubmitBtn) {
    resubmitBtn.addEventListener("click", async () => {
      resubmitBtn.disabled = true;
      resubmitBtn.textContent = "Resubmitting…";
      await resubmit(request.id);
    });
  }
}

function rowHtml(label, status) {
  const badgeClass = status === "approved" ? "badge-approved" : status === "rejected" ? "badge-rejected" : "badge-pending";
  const text = status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending";
  return `<div class="row"><span class="row-label">${label}</span><span class="badge ${badgeClass}">${text}</span></div>`;
}
