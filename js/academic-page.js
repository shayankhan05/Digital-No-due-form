import { requireAuth, wireLogout } from "./auth.js";
import { initThemeToggle } from "./theme.js";
import { academicDetails, academicHTML, page, record, saveMarks } from "./academic.js";
import { escapeHtml as e, errorState, profileHTML, busy } from "./ui.js";
import { approvalHTML } from "./student-updates.js";
import { db } from "./firebase-config.js";
import { collection, getDocs, query, where, orderBy, limit } from "./api-store.js";
wireLogout(); initThemeToggle();
const content = document.getElementById("content");
let actor, cursor, rows = [], classLoadVersion = 0;
window.addEventListener("hashchange", () => { if (actor?.role === "mentor" && location.hash === "#teaching") listClasses().catch(error => errorState(content,error)); });
requireAuth(["student", "subject_faculty", "mentor", "admin"]).then(async profile => {
  actor = profile;
  document.getElementById("backLink").href = ({ student: "student-dashboard.html", subject_faculty: "approver-dashboard.html", mentor: "mentor-dashboard.html", admin: "admin-dashboard.html" })[actor.role];
  const uid = new URLSearchParams(location.search).get("student");
  if (actor.role === "student" || uid) return showStudent(actor.role === "student" ? actor.uid : uid);
  if (actor.role === "mentor" && location.hash !== "#teaching") return listMentees();
  return listClasses();
}).catch(error => errorState(content, error));
async function showStudent(uid) {
  const details = await academicDetails(uid);
  const requests = await getDocs(query(collection(db, "noDueRequests"), where("studentId", "==", uid), ...(actor.role === "mentor" ? [where("mentorId", "==", actor.uid)] : []), orderBy("createdAt", "desc"), limit(10)));
  content.innerHTML = `${academicHTML(details)}<div class="card"><h2>No-Due history</h2>${requests.empty ? "No requests yet." : requests.docs.map(d => `<h3>${e(d.data().status)}</h3>${approvalHTML(d.data())}`).join("")}</div>`;
}
async function listMentees(append = false) {
  const result = await page("students", [["mentorId", "==", actor.uid]], append ? cursor : null);
  cursor = result.cursor; rows = append ? [...rows, ...result.rows] : result.rows;
  const summaries = await Promise.all(rows.map(async s => { const snap = await getDocs(query(collection(db,"noDueRequests"),where("studentId","==",s.id),where("mentorId","==",actor.uid),orderBy("createdAt","desc"),limit(1))); return {...s,clearance:snap.docs[0]?.data().status || "Not submitted"}; }));
  content.innerHTML = `${profileHTML(actor)}<a href="academic.html#teaching">My teaching classes & marks</a><div class="card"><h2>My mentees</h2>${summaries.map(s => `<div class="row"><span>${e(s.name)} · ${e(s.usn)}<br>Semester ${e(s.semester)} · Section ${e(s.section)}<br>No-Due: ${e(s.clearance)}</span><a href="academic.html?student=${encodeURIComponent(s.id)}">View details</a></div>`).join("") || "No mentees assigned."}</div>${result.more ? '<button id="more" class="btn-sm">Load more mentees</button>' : ""}`;
  document.getElementById("more")?.addEventListener("click", event => busy(event.target, () => listMentees(true)));
}
async function listClasses() {
  const result = await page("offerings", actor.role === "admin" ? [] : [["teacherId", "==", actor.uid]], null, 100);
  content.innerHTML = `${profileHTML(actor)}<div class="card"><h2>Subjects & sections handled</h2>${result.rows.map(o => `<button class="btn-sm class-button" data-id="${e(o.id)}">${e(o.subjectName)} · ${e(o.subjectCode)} · Sem ${e(o.semester)} / ${e(o.section)}</button>`).join("") || "No teaching assignments linked."}</div><div id="classContent"></div>`;
  document.querySelectorAll(".class-button").forEach(button => button.onclick = () => busy(button, () => showClass(button.dataset.id)));
}
async function showClass(id, append = false) {
  const target = document.getElementById("classContent");
  const version = ++classLoadVersion;
  if (!append) target.innerHTML = '<div class="center-state">Loading class…</div>';
  const offering = await record("offerings", id);
  const result = await page("enrollments", [["offeringId", "==", id], ["active", "==", true], ...(actor.role === "admin" ? [] : [["teacherId", "==", actor.uid]])], append ? cursor : null);
  const nextRows = append ? [...rows, ...result.rows] : result.rows;
  const assignments = await page("assignments", [["offeringId", "==", id]], null, 50);
  const loaded = await Promise.all(nextRows.map(async enrollment => ({ enrollment, student: await record("students", enrollment.studentId), marks: await record("marks", enrollment.id), requests: (await getDocs(query(collection(db,"noDueRequests"),where("studentId","==",enrollment.studentId),where("approverIds","array-contains",actor.uid),orderBy("createdAt","desc"),limit(1)))).docs.map(d=>d.data()) })));
  if (version !== classLoadVersion) return;
  cursor = result.cursor; rows = nextRows;
  target.innerHTML = `<div class="card"><h2>${e(offering.subjectName)} · ${e(offering.section)}</h2><h3>Assignments</h3>${assignments.rows.map(a => `<p><strong>${e(a.title)}</strong> · ${e(a.dueDate)}<br>${e(a.description)} · ${e(a.status)}</p>`).join("") || "No assignments."}</div>${loaded.map(({enrollment,student,marks,requests}) => `<form class="card marks-form" data-id="${e(enrollment.id)}"><h3>${e(student?.name)} · ${e(student?.usn)}</h3><p>Semester ${e(offering.semester)} · Section ${e(offering.section)} · ${e(offering.subjectCode)}</p>${(offering.components || []).map(c => `<label>${e(c.label)} / ${e(c.max)}<input name="${e(c.id)}" type="number" min="0" max="${e(c.max)}" step="0.01" value="${e(marks?.scores?.[c.id] ?? "")}"></label>`).join("")}<button class="btn-primary" type="submit">Save marks</button><p class="muted">No-Due: ${e(requests[0]?.status || "Not submitted")}</p></form>`).join("") || '<div class="card">No enrolled students.</div>'}${result.more ? '<button id="more" class="btn-sm">Load more students</button>' : ""}`;
  target.querySelectorAll(".marks-form").forEach(form => form.onsubmit = event => {
    event.preventDefault(); const enrollment = rows.find(r => r.id === form.dataset.id);
    const scores = Object.fromEntries([...new FormData(form)].filter(([,v]) => v !== "").map(([k,v]) => [k, Number(v)]));
    busy(form.querySelector("button"), async () => { await saveMarks(enrollment, offering, scores, actor.uid); alert("Marks saved."); });
  });
  document.getElementById("more")?.addEventListener("click", event => busy(event.target, () => showClass(id, true)));
}
