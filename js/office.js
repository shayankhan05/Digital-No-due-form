import { db } from "./firebase-config.js";
import { requireAuth, wireLogout } from "./auth.js";
import { issueHallTicket, STATUS, statusLabel } from "./workflow.js";
import { collection, query, where, getDocs, collectionGroup } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

wireLogout();
const result = document.getElementById("result");
let officer = null;

requireAuth().then((profile) => { officer = profile; });

document.getElementById("searchBtn").addEventListener("click", search);
document.getElementById("usnInput").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });

async function search() {
  const usn = document.getElementById("usnInput").value.trim();
  if (!usn) return;
  result.innerHTML = `<div class="center-state">Searching…</div>`;

  const q = query(collection(db, "noDueRequests"), where("usn", "==", usn));
  const snap = await getDocs(q);

  if (snap.empty) {
    result.innerHTML = `<div class="center-state">No request found for ${usn}.</div>`;
    return;
  }

  const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const request = requests[0];

  const approvalsSnap = await getDocs(collection(db, "noDueRequests", request.id, "approvals"));
  const items = approvalsSnap.docs.map((d) => d.data());

  render(request, items);
}

function render(request, items) {
  const eligible = request.status === STATUS.CLEARED;
  const alreadyIssued = request.status === STATUS.ISSUED;
  const initials = (request.studentName || "?").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  const checklistRows = [
    ...items.map((i) => checkRow(i.label || i.approverType, i.status)),
    checkRow("Mentor / soft skill", request.mentorApproval?.status),
    checkRow("Coordinator / HOD sign-off", request.hodApproval?.status),
  ].join("");

  result.innerHTML = `
    <div class="card">
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
        <div class="avatar" style="width:40px; height:40px;">${initials}</div>
        <div style="flex:1;">
          <p style="margin:0; font-weight:500;">${request.studentName}</p>
          <p class="muted" style="margin:0;">${request.usn} · Sem ${request.semester} · Sec ${request.section}</p>
        </div>
        <span class="badge ${eligible || alreadyIssued ? "badge-approved" : "badge-pending"}">
          ${alreadyIssued ? "Already issued" : eligible ? "Eligible" : statusLabel(request.status)}
        </span>
      </div>
      <div class="list" style="margin-bottom:14px;">${checklistRows}</div>
      <button id="issueBtn" class="btn-primary btn-block" ${eligible ? "" : "disabled"}>
        ${alreadyIssued ? "Hall ticket already issued" : "Issue hall ticket"}
      </button>
    </div>
  `;

  const issueBtn = document.getElementById("issueBtn");
  if (eligible) {
    issueBtn.addEventListener("click", async () => {
      if (!confirm(`Confirm hall ticket issuance for ${request.studentName} (${request.usn})?`)) return;
      issueBtn.disabled = true;
      issueBtn.textContent = "Issuing…";
      await issueHallTicket(request.id, officer?.name);
      search(); // refresh
    });
  }
}

function checkRow(label, status) {
  const cls = status === "approved" ? "badge-approved" : status === "rejected" ? "badge-rejected" : "badge-pending";
  const text = status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending";
  return `<div class="row"><span class="row-label">${label}</span><span class="badge ${cls}">${text}</span></div>`;
}
