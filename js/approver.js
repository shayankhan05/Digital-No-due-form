import { db } from "./firebase-config.js";
import { requireAuth, wireLogout } from "./auth.js";
import { actOnStage1Item } from "./workflow.js";
import {
  collectionGroup, query, where, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

wireLogout();
const content = document.getElementById("content");
const header = document.getElementById("approverHeader");

const ROLE_LABELS = {
  subject_faculty: "Subject faculty",
  library: "Library in-charge",
  physics_lab: "Physics lab in-charge",
  chemistry_lab: "Chemistry lab in-charge",
  accounts: "Accounts in-charge",
};

requireAuth().then((approver) => {
  header.textContent = `${approver.name} · ${ROLE_LABELS[approver.role] || approver.role}${approver.subjectCode ? " (" + approver.subjectCode + ")" : ""}`;

  const clauses = [where("approverType", "==", approver.role), where("status", "==", "pending")];
  if (approver.role === "subject_faculty") {
    clauses.push(where("subjectCode", "==", approver.subjectCode));
  }
  const q = query(collectionGroup(db, "approvals"), ...clauses);

  onSnapshot(q, (snap) => {
    if (snap.empty) {
      content.innerHTML = `<div class="center-state">No pending approvals right now.</div>`;
      return;
    }
    const rows = snap.docs.map((d) => rowHtml(d)).join("");
    content.innerHTML = `<div class="list">${rows}</div>`;
    wireRowActions(approver);
  }, (err) => {
    content.innerHTML = `<div class="center-state">Couldn't load requests.<br><span class="muted">${err.message}</span></div>`;
  });
});

function rowHtml(docSnap) {
  const a = docSnap.data();
  const initials = (a.studentName || "?").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  return `
    <div class="row" data-approval-id="${docSnap.id}" data-request-id="${a.requestId}">
      <div style="display:flex; align-items:center; gap:10px; flex:1;">
        <div class="avatar">${initials}</div>
        <div>
          <div class="row-label">${a.studentName}${a.label && a.label !== a.studentName ? "" : ""}</div>
          <div class="row-sub">${a.usn} · Sec ${a.section}${a.label ? " · " + a.label : ""}</div>
        </div>
      </div>
      <div class="actions-right">
        <button class="btn-approve btn-sm approve-btn">Approve</button>
        <button class="btn-reject btn-sm reject-btn">Reject</button>
      </div>
    </div>
    <div class="reject-panel hidden" data-for="${docSnap.id}" style="padding:0 14px 14px;">
      <div class="reject-box">
        <label>Reason for rejection</label>
        <textarea placeholder="E.g., assignment not submitted" rows="2"></textarea>
        <div class="actions-right">
          <button class="btn-sm cancel-reject-btn">Cancel</button>
          <button class="btn-sm confirm-reject-btn" style="background:var(--red-text); color:white; border:none;">Confirm rejection</button>
        </div>
      </div>
    </div>
  `;
}

function wireRowActions(approver) {
  content.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const row = e.target.closest(".row");
      btn.disabled = true;
      await actOnStage1Item(row.dataset.requestId, row.dataset.approvalId, "approved", "", approver.name);
    });
  });

  content.querySelectorAll(".reject-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const row = e.target.closest(".row");
      content.querySelector(`.reject-panel[data-for="${row.dataset.approvalId}"]`).classList.remove("hidden");
    });
  });

  content.querySelectorAll(".cancel-reject-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.target.closest(".reject-panel").classList.add("hidden");
    });
  });

  content.querySelectorAll(".confirm-reject-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const panel = e.target.closest(".reject-panel");
      const reason = panel.querySelector("textarea").value.trim();
      if (!reason) { alert("A reason is required."); return; }
      const approvalId = panel.dataset.for;
      const row = content.querySelector(`.row[data-approval-id="${approvalId}"]`);
      btn.disabled = true;
      await actOnStage1Item(row.dataset.requestId, approvalId, "rejected", reason, approver.name);
    });
  });
}
