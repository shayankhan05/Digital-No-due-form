import { db } from "./firebase-config.js";
import { requireAuth, wireLogout } from "./auth.js";
import { actAsMentor, STATUS } from "./workflow.js";
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

wireLogout();
const content = document.getElementById("content");
const header = document.getElementById("mentorHeader");

requireAuth().then((mentor) => {
  header.textContent = `${mentor.name} · Mentor`;

  const q = query(
    collection(db, "noDueRequests"),
    where("mentorId", "==", mentor.uid),
    where("status", "==", STATUS.PENDING_MENTOR)
  );

  onSnapshot(q, (snap) => {
    if (snap.empty) {
      content.innerHTML = `<div class="banner">Only mentees who have completed all Stage 1 approvals (subjects, labs, library, accounts) appear here.</div><div class="center-state">Nobody's waiting on you right now.</div>`;
      return;
    }
    const cards = snap.docs.map((d) => cardHtml(d)).join("");
    content.innerHTML = `<div class="banner">Only mentees who have completed all Stage 1 approvals (subjects, labs, library, accounts) appear here.</div>${cards}`;
    wireActions(mentor);
  });
});

function cardHtml(docSnap) {
  const r = docSnap.data();
  return `
    <div class="card" data-request-id="${docSnap.id}">
      <p class="row-label" style="margin:0;">${r.studentName}</p>
      <p class="row-sub" style="margin:0 0 10px;">${r.usn} · Sec ${r.section}</p>
      <p class="muted" style="margin:0 0 10px;">Stage 1 cleared ✓</p>
      <div class="reject-fields hidden">
        <label>Reason for rejection</label>
        <textarea placeholder="E.g., incomplete soft-skill portfolio" rows="2"></textarea>
      </div>
      <div class="actions-right">
        <button class="btn-reject btn-sm reject-btn">Reject</button>
        <button class="btn-approve btn-sm approve-btn">Approve</button>
      </div>
      <p class="muted" style="margin:8px 0 0; font-size:12px;">Approving moves this student to Coordinator/HOD review.</p>
    </div>
  `;
}

function wireActions(mentor) {
  content.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const card = e.target.closest(".card");
      const fields = card.querySelector(".reject-fields");
      if (!fields.classList.contains("hidden")) return; // mid-rejection, ignore stray click
      btn.disabled = true;
      await actAsMentor(card.dataset.requestId, "approved", "");
    });
  });

  content.querySelectorAll(".reject-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const card = e.target.closest(".card");
      const fields = card.querySelector(".reject-fields");
      if (fields.classList.contains("hidden")) {
        fields.classList.remove("hidden");
        btn.textContent = "Confirm rejection";
        return;
      }
      const reason = fields.querySelector("textarea").value.trim();
      if (!reason) { alert("A reason is required."); return; }
      btn.disabled = true;
      await actAsMentor(card.dataset.requestId, "rejected", reason);
    });
  });
}
