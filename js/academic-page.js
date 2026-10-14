import {isMentor} from './capabilities.js';
import {compareUSN,rosterMatches} from './marks-roster.js';
import {apiFetch} from './api.js';
import {departmentLabel} from './department.js';
import { requireAuth, wireLogout } from "./auth.js";
import { initThemeToggle } from "./theme.js";
import { academicDetails, academicHTML, page, record, saveMarks } from "./academic.js";
import { escapeHtml as e, errorState, profileHTML, busy } from "./ui.js";
import { approvalHTML } from "./student-updates.js";
import { db } from "./firebase-config.js";
import { collection, getDocs, query, where, orderBy, limit } from "./api-store.js";
import {mountMarksCSV} from './marks-csv.js';
wireLogout(); initThemeToggle();
const content = document.getElementById("content");
let actor, cursor, rows = [], classLoadVersion = 0;
window.addEventListener("hashchange", () => { if (isMentor(actor) && location.hash === "#teaching") listClasses().catch(error => errorState(content,error)); });
requireAuth(["student", "subject_faculty", "mentor", "admin", "super_admin"]).then(async profile => {
  actor = profile;
  document.getElementById("backLink").href = ({ student: "student-dashboard.html", subject_faculty: "approver-dashboard.html", mentor: "mentor-dashboard.html", admin: "admin-dashboard.html", super_admin: "super-admin-dashboard.html" })[actor.role];
  const uid = new URLSearchParams(location.search).get("student");
  if (actor.role === "student" || uid) return showStudent(actor.role === "student" ? actor.uid : uid);
  if ((actor.role==='mentor'||isMentor(actor)&&location.hash==='#mentees') && location.hash !== "#teaching") return listMentees();
  return listClasses();
}).catch(error => errorState(content, error));
async function showStudent(uid) {
  const details = await academicDetails(uid);
  const requests = await getDocs(query(collection(db, "noDueRequests"), where("studentId", "==", uid), ...(actor.role === "mentor" ? [where("mentorId", "==", actor.uid)] : []), orderBy("createdAt", "desc"), limit(10)));
  content.innerHTML = `${academicHTML(details)}<div class="card"><h2>No-Due history</h2>${requests.empty ? "No requests yet." : requests.docs.map(d => `<h3>${e(d.data().status)}</h3>${approvalHTML(d.data())}`).join("")}</div>`;
}
async function listMentees(append = false) {
  const result=await apiFetch('/api/academic/mentees?limit=30'+(append&&cursor?'&cursor='+encodeURIComponent(cursor):''));cursor=result.cursor;rows=append?[...rows,...result.rows]:result.rows;const summaries=rows;
  content.innerHTML = `${profileHTML(actor)}<a href="academic.html#teaching">My teaching classes & marks</a><div class="card"><h2>My mentees</h2>${summaries.map(s => `<div class="row"><span>${e(s.name)} · ${e(s.usn)}<br>Semester ${e(s.semester)} · Section ${e(s.section)}<br>No-Due: ${e(s.clearance)}</span><a href="academic.html?student=${encodeURIComponent(s.id)}">View details</a></div>`).join("") || "No mentees assigned."}</div>${result.more ? '<button id="more" class="btn-sm">Load more mentees</button>' : ""}`;
  document.getElementById("more")?.addEventListener("click", event => busy(event.target, () => listMentees(true)));
}
async function listClasses() {
  const result = await page("offerings", ["admin","super_admin"].includes(actor.role) ? [] : [["teacherId", "==", actor.uid]], null, 100);
  content.innerHTML = `${profileHTML(actor)}<div class="card"><h2>Subjects & sections handled</h2>${result.rows.map(o => `<button class="btn-sm class-button" data-id="${e(o.id)}">${e(o.subjectName)} · ${e(o.subjectCode)} · Sem ${e(o.semester)} / ${e(o.section)}</button>`).join("") || "No teaching assignments linked."}</div><div id="classContent"></div>`;
  document.querySelectorAll(".class-button").forEach(button => button.onclick = () => busy(button, () => showClass(button.dataset.id)));
}
async function showClass(id) {
  const target=document.getElementById('classContent'),version=++classLoadVersion;
  if(target.querySelector('.marks-row.is-dirty')&&!confirm('Discard unsaved mark changes?'))return;
  target.innerHTML='<div class="center-state">Loading class…</div>';
  const [offering,result,assignments]=await Promise.all([record('offerings',id),apiFetch('/api/academic/roster/'+encodeURIComponent(id)),page('assignments',[['offeringId','==',id]],null,50)]);
  if(version!==classLoadVersion)return;
  const loaded=result.rows.sort((a,b)=>compareUSN(a.student.usn,b.student.usn));
  target.innerHTML=`<div class="card"><h2>${e(offering.subjectName)} · ${e(offering.section)}</h2><p>${e(departmentLabel(offering.department))}</p><h3>Assignments</h3>${assignments.rows.map(a=>`<p><strong>${e(a.title)}</strong> · ${e(a.dueDate)}<br>${e(a.description)} · ${e(a.status)}</p>`).join('')||'No assignments.'}</div>
  <section class="card"><h2>Student marks</h2><label>Search by USN or student name<input id="marksSearch" type="search" placeholder="Enter USN or name"></label><p id="marksSearchCount" class="muted" role="status"></p><div class="table-scroll marks-table-scroll"><table class="manual-marks-table"><thead><tr><th scope="col">USN</th><th scope="col">Student Name</th>${offering.components.map(c=>`<th scope="col">${e(c.label)} / ${e(c.max)}</th>`).join('')}<th scope="col">No-Due</th><th scope="col">Action</th></tr></thead><tbody>${loaded.map(({enrollment,student,marks,noDueStatus},i)=>`<tr class="marks-row" data-index="${i}"><td>${e(student.usn)}</td><td>${e(student.name)}</td>${offering.components.map(c=>`<td><input form="marks-row-${i}" aria-label="${e(student.usn)} ${e(c.label)}" name="${e(c.id)}" type="number" min="0" max="${e(c.max)}" step="0.01" value="${e(marks?.scores?.[c.id]??'')}"></td>`).join('')}<td>${e(noDueStatus)}</td><td><form id="marks-row-${i}" class="marks-form" data-id="${e(enrollment.id)}"><button class="btn-sm" type="submit" disabled>Save</button><span class="marks-row-status muted" role="status">Saved</span></form></td></tr>`).join('')}</tbody></table></div>${!loaded.length?'<p>No enrolled students.</p>':''}</section>`;
  const filter=()=>{const term=document.getElementById('marksSearch').value;let shown=0;target.querySelectorAll('.marks-row').forEach(tr=>{tr.hidden=!rosterMatches(loaded[Number(tr.dataset.index)].student,term);if(!tr.hidden)shown++;});document.getElementById('marksSearchCount').textContent=shown+' / '+loaded.length+' students';};
  document.getElementById('marksSearch').oninput=filter;filter();
  target.querySelectorAll('.marks-row').forEach(tr=>{
    const form=tr.querySelector('form'),button=form.querySelector('button'),status=form.querySelector('.marks-row-status'),inputs=[...tr.querySelectorAll('input')];let saved=inputs.map(i=>i.value),saving=false;
    const dirty=()=>inputs.some((input,i)=>input.value!==saved[i]);
    inputs.forEach(input=>input.oninput=()=>{const changed=dirty();tr.classList.toggle('is-dirty',changed);button.disabled=saving||!changed;status.textContent=changed?'Unsaved changes':'Saved';});
    form.onsubmit=async event=>{event.preventDefault();if(saving||!dirty())return;if(!inputs.every(input=>input.reportValidity()))return;
      const changes=inputs.filter((input,i)=>input.value!==saved[i]);if(changes.some(input=>input.value==='')){status.textContent='Enter a mark; blank does not clear saved marks.';return;}
      const scores=Object.fromEntries(changes.map(input=>[input.name,Number(input.value)])),submitted=inputs.map(input=>input.value);saving=true;button.disabled=true;status.textContent='Saving…';
      try{await saveMarks(loaded[Number(tr.dataset.index)].enrollment,offering,scores,actor.uid);saved=submitted;status.textContent=dirty()?'Unsaved changes':'Saved';tr.classList.toggle('is-dirty',dirty());}catch(error){status.textContent=error.message;}finally{saving=false;button.disabled=!dirty();}
    };
  });
  if(actor.uid===offering.teacherId)await mountMarksCSV(target,offering,()=>showClass(id));
}
window.addEventListener('beforeunload',event=>{if(document.querySelector('.marks-row.is-dirty')){event.preventDefault();event.returnValue='';}});
