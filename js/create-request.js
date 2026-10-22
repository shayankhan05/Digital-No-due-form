import { requireAuth } from "./auth.js";
import { initThemeToggle } from "./theme.js";
import { submitRequest, getRequiredApprovers } from "./workflow.js";
import { studentProfile } from "./academic.js";
import { escapeHtml as e, errorState } from "./ui.js";
import {db} from './firebase-config.js';
import {collection,query,where,limit,getDocs} from './api-store.js';
initThemeToggle();

const content = document.getElementById("content");

requireAuth(["student"]).then(async (profile) => {
  const student = await studentProfile(profile.uid, profile);
  const active=await getDocs(query(collection(db,'noDueRequests'),where('studentId','==',profile.uid),where('status','in',['pending_stage1','pending_mentor','pending_hod','pending_office','cleared','rejected']),limit(1)));
  if(!active.empty){content.innerHTML='<div class="card"><h2>Your existing No-Due request</h2><p>You already have an active No-Due request. Please complete or resolve the existing request before creating another.</p><a class="btn-sm" href="student-dashboard.html#requests">View request and status</a></div>';return;}
  const keyName='noDueSubmitKey:'+profile.uid;let requestKey=sessionStorage.getItem(keyName);if(!requestKey){requestKey=crypto.randomUUID();sessionStorage.setItem(keyName,requestKey);}
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
    <div class="banner">Your enrolled subject teachers, Library, Accounts and Sports approve first, followed by Mentor, HOD and Office. You cannot select or remove approvers.</div>

    <label class="confirmation-row" style="font-size:13px; color:var(--text);">
      <input type="checkbox" id="confirmCheck"  />
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
      await submitRequest(student,requestKey);sessionStorage.removeItem(keyName);
      window.location.href = "student-dashboard.html";
    } catch (err) {
      document.getElementById("submitError").textContent = err.message;
      document.getElementById("submitError").classList.remove("hidden");
      submitBtn.disabled = err.code==='already-exists';
      submitBtn.textContent = "Submit request";
    }
  });
}).catch(error => errorState(content, error));
