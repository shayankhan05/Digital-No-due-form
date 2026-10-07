import { requireAuth } from "./auth.js";
import { initThemeToggle } from "./theme.js";
import { submitRequest, getRequiredApprovers } from "./workflow.js";
import { studentProfile } from "./academic.js";
import { escapeHtml as e, errorState } from "./ui.js";
initThemeToggle();

const content = document.getElementById("content");

requireAuth(["student"]).then(async (profile) => {
  const student = await studentProfile(profile.uid, profile);
  const required = await getRequiredApprovers(profile.uid);
  const chips = required.map((r) => `<span class="badge badge-locked" style="margin:0 6px 6px 0; display:inline-block;">${e(r.subjectCode || '')} ${e(r.label)}${r.teacherName ? ` — ${e(r.teacherName)}`:''}</span>`).join("");

  content.innerHTML = `
    <div class="card">
      <p class="section-label" style="margin-top:0;">Student information</p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px 16px; font-size:14px;">
        <div><span class="muted">USN</span><br>${e(student.usn)}</div>
        <div><span class="muted">Name</span><br>${e(student.name)}</div>
        <div><span class="muted">Semester</span><br>${e(student.semester)}</div>
        <div><span class="muted">Section</span><br>${e(student.section)}</div>
      </div>
    </div>

    <p class="section-label">Approval requirements</p>
    <div style="margin-bottom:8px;">${chips}</div>
    <div class="banner">Your enrolled subject teachers, Library and Accounts approve first, followed by Mentor, HOD and Office. You cannot select or remove approvers.</div>

    <label style="display:flex; align-items:flex-start; gap:8px; font-size:13px; color:var(--text);">
      <input type="checkbox" id="confirmCheck" style="width:auto; margin:2px 0 0;" />
      <span>I confirm all assignment copies have been submitted and I'm ready to start the No-Due process.</span>
    </label>

    <button id="submitBtn" class="btn-primary btn-block" disabled style="margin-top:16px;">Submit request</button>
    <p id="submitError" class="hidden" style="color:#c53030; font-size:13px; margin-top:8px;"></p>
  `;

  const checkbox = document.getElementById("confirmCheck");
  const submitBtn = document.getElementById("submitBtn");
  checkbox.addEventListener("change", () => { submitBtn.disabled = !checkbox.checked; });

  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    try {
      await submitRequest(student);
      window.location.href = "student-dashboard.html";
    } catch (err) {
      document.getElementById("submitError").textContent = err.message;
      document.getElementById("submitError").classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit request";
    }
  });
}).catch(error => errorState(content, error));
