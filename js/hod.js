import { db } from "./firebase-config.js";
import { requireAuth, wireLogout } from "./auth.js";
import { actAsHod, STATUS } from "./workflow.js";
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

wireLogout();
const content = document.getElementById("content");

requireAuth().then(() => {
  const q = query(collection(db, "noDueRequests"), where("status", "==", STATUS.PENDING_HOD));

  onSnapshot(q, (snap) => {
    const banner = `<div class="banner">Only students who have cleared all subjects, departments, and mentor review appear here.</div>`;
    if (snap.empty) {
      content.innerHTML = `${banner}<div class="center-state">Nothing waiting on final approval right now.</div>`;
      return;
    }
    const rows = snap.docs.map((d) => rowHtml(d)).join("");
    content.innerHTML = `${banner}<div class="list">${rows}</div>`;
    wireActions();
  });
});

function rowHtml(docSnap) {
  const r = docSnap.data();
  return `
    <div class="row" data-request-id="${docSnap.id}" style="flex-wrap:wrap;">
      <div>
        <div class="row-label">${r.studentName}</div>
        <div class="row-sub">${r.usn} · Sec ${r.section}</div>
      </div>
      <span class="badge badge-approved">Stage 1 + mentor cleared</span>
      <div class="actions-right" style="width:100%; margin-top:8px;">
        <button class="btn-reject btn-sm reject-btn">Reject</button>
        <button class="btn-approve btn-sm approve-btn">Approve</button>
      </div>
      <div class="reject-fields hidden" style="width:100%; margin-top:8px;">
        <label>Reason for rejection</label>
        <textarea placeholder="Provide detailed feedback for the student" rows="2"></textarea>
      </div>
    </div>
  `;
}

function wireActions() {
  content.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const row = e.target.closest(".row");
      btn.disabled = true;
      await actAsHod(row.dataset.requestId, "approved", "");
    });
  });

  content.querySelectorAll(".reject-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const row = e.target.closest(".row");
      const fields = row.querySelector(".reject-fields");
      if (fields.classList.contains("hidden")) {
        fields.classList.remove("hidden");
        btn.textContent = "Confirm rejection";
        return;
      }
      const reason = fields.querySelector("textarea").value.trim();
      if (!reason) { alert("A reason is required."); return; }
      btn.disabled = true;
      await actAsHod(row.dataset.requestId, "rejected", reason);
    });
  });
}
