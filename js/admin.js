import { db } from "./firebase-config.js";
import { requireAuth, wireLogout } from "./auth.js";
import { initThemeToggle } from "./theme.js";
import { doc, setDoc, writeBatch, serverTimestamp, arrayRemove } from "./api-store.js";
import { page, record } from "./academic.js";
import { escapeHtml as e, errorState, busy } from "./ui.js";
import { ROLES, SERVICES, stableId, saveAccount, saveOffering, enrollStudent, preparePlan } from "./admin-data.js";
import { upgradeLegacyRequest } from "./workflow.js";
import { parseCSV } from "./csv.js";
wireLogout(); initThemeToggle();
const content = document.getElementById("content");
const fields = {
  users: ["uid","name","role","email","phone","facultyId","department","usn","semester","section","mentorId"],
  students: ["uid","name","email","phone","department","scheme","usn","semester","section","mentorId"],
  subjects: ["id","name","code"],
  offerings: ["id","subjectId","department","scheme","semester","section","teacherId","active"],
  enrollments: ["studentId","offeringId"],
  assignments: ["id","offeringId","title","description","dueDate","status"],
  settings: [...SERVICES,"hodId","officeId"]
};
let selected = "students", cursor, listed = [];
requireAuth(["admin"]).then(() => render()).catch(error => errorState(content, error));
async function render() {
  content.innerHTML = `<div class="banner">Create sign-in accounts in Firebase Authentication, then link their actual UID here.</div><div class="tab-strip">${Object.keys(fields).map(key => `<button class="btn-sm tab" data-key="${key}">${e(({users:"Staff & accounts",offerings:"Classes & teachers",enrollments:"Student subjects",settings:"Workflow assignments"})[key] || key)}</button>`).join("")}</div>
    <div class="card"><h2>${e(selected)}</h2><form id="recordForm">${fields[selected].map(key => `<label>${e(key)}${key === "role" ? `<select name="role">${ROLES.map(r => `<option>${e(r)}</option>`).join("")}</select>` : `<input name="${e(key)}" ${key === "semester" ? 'type="number" min="1" max="12"' : key === "email" ? 'type="email"' : key === "dueDate" ? 'type="date"' : 'type="text"'}>`}</label>`).join("")}${selected === "offerings" ? '<label>Assessments: ID, label, maximum (one per line)<textarea name="components" rows="4" placeholder="ia1, Internal assessment 1, 30"></textarea></label>' : ""}<button class="btn-primary" type="submit">Save record</button></form><p id="saveMessage" role="status"></p></div>
    <div class="card"><label>Exact document ID / UID<input id="lookup"></label><button id="lookupBtn" class="btn-sm">Find & edit</button><div id="records"></div><button id="next" class="btn-sm">Load more records</button></div>
    <div class="card"><h2>Prepare student clearance</h2><label>Student Auth UID<input id="planUid"></label><button id="planBtn" class="btn-primary">Refresh academic mappings & clearance plan</button><p>Run after changing mentor, teacher, class or enrollments. Existing requests retain their assigned approvers.</p></div>
    <div class="card"><h2>Student CSV import</h2><p>Headers: uid,name,usn,email,phone,semester,section,mentorId. Actual Auth UIDs are required.</p><input id="csv" type="file" accept=".csv"><button id="csvPreviewBtn" class="btn-sm">Preview CSV</button><div id="csvPreview"></div><button id="csvSave" class="btn-primary" disabled>Import reviewed students</button></div>
    <div class="card"><h2>Legacy request compatibility</h2><label>Existing request ID<input id="legacyId"></label><button id="legacyBtn" class="btn-sm">Review & upgrade existing request</button><p>Preserves existing approvals and request status. Review mappings before confirming.</p></div>`;
  document.querySelectorAll(".tab").forEach(b => b.onclick = () => { selected = b.dataset.key; cursor = null; listed = []; render().catch(error => errorState(content,error)); });
  document.getElementById("recordForm").onsubmit = event => { event.preventDefault(); busy(event.target.querySelector("button"), () => save(new FormData(event.target))); };
  document.getElementById("lookupBtn").onclick = event => busy(event.target, async () => { const row = await record(selected, document.getElementById("lookup").value.trim()); if (!row) throw new Error("Record not found."); edit(row); });
  document.getElementById("next").onclick = event => busy(event.target, () => loadList(true));
  document.getElementById("planBtn").onclick = event => busy(event.target, async () => { await preparePlan(document.getElementById("planUid").value.trim()); alert("Academic mappings and clearance plan are ready."); });
  document.getElementById("legacyBtn").onclick = event => busy(event.target, async () => {
    const id = document.getElementById("legacyId").value.trim(), r = await record("noDueRequests", id);
    if (!r) throw new Error("Request not found.");
    const p = await record(`students/${r.studentId}/clearance`, "plan");
    if (!p?.valid) throw new Error("Prepare the student clearance plan first.");
    if (confirm(`Upgrade ${r.studentName} (${r.usn}), status ${r.status}, using current mappings?`)) { await upgradeLegacyRequest(id, p); alert("Legacy request upgraded; decisions preserved."); }
  });
  let csvRows = [];
  document.getElementById("csvPreviewBtn").onclick = event => busy(event.target, async () => {
    const file = document.getElementById("csv").files[0]; if (!file) throw new Error("Choose a CSV file.");
    csvRows = parseCSV(await file.text());
    document.getElementById("csvPreview").innerHTML = `<p>${csvRows.length} records</p>${csvRows.map(s => `<p>${e(s.uid)} · ${e(s.name)} · ${e(s.usn)} · ${e(s.mentorId)}</p>`).join("")}`;
    document.getElementById("csvSave").disabled = !csvRows.length;
  });
  document.getElementById("csv").onchange = () => { csvRows = []; document.getElementById("csvSave").disabled = true; };
  document.getElementById("csvSave").onclick = event => busy(event.target, async () => {
    let count = 0;
    for (const row of csvRows) { await saveAccount({...row,role:"student"}); count++; document.getElementById("csvPreview").textContent = `Imported ${count}/${csvRows.length}.`; }
    csvRows=[]; alert("Students imported. Assign subjects, then prepare their plans.");
  });
  await loadList();
}
async function edit(row) {
  if (selected === "users" && row.role === "student") row = {...row, ...(await record("students",row.id))};
  const form = document.getElementById("recordForm");
  for (const key of fields[selected]) if (form.elements[key]) form.elements[key].value = row[key] ?? (key === "uid" ? row.id : "");
  if (selected === "offerings") form.elements.components.value = (row.components || []).map(c => `${c.id}, ${c.label}, ${c.max}`).join("\n");
}
async function loadList(append = false) {
  const result = await page(selected, [], append ? cursor : null);
  cursor = result.cursor; listed = append ? [...listed,...result.rows] : result.rows;
  document.getElementById("records").innerHTML = listed.map(row => `<div class="row"><span>${e(row.name || row.title || row.subjectName || row.id)}<br><small>${e(row.id)} · ${e(row.role || row.subjectCode || row.usn || "")}</small></span><button class="btn-sm edit" data-id="${e(row.id)}">Edit</button>${selected === "enrollments" ? `<button class="btn-sm deactivate" data-id="${e(row.id)}">Deactivate</button>` : ""}</div>`).join("") || "No records yet.";
  document.getElementById("next").hidden = !result.more;
  document.querySelectorAll(".edit").forEach(b => b.onclick = () => edit(listed.find(r => r.id === b.dataset.id)));
  document.querySelectorAll(".deactivate").forEach(b => b.onclick = () => busy(b, async () => {
    const row = listed.find(r => r.id === b.dataset.id);
    const batch = writeBatch(db);
    batch.update(doc(db,"enrollments",row.id),{active:false});
    batch.set(doc(db,"students",row.studentId,"clearance","plan"),{valid:false},{merge:true});
    batch.update(doc(db,"students",row.studentId),{teacherIds:arrayRemove(row.teacherId),offeringIds:arrayRemove(row.offeringId)});
    await batch.commit();
    alert("Enrollment deactivated. Refresh the student clearance plan.");
  }));
}
async function save(formData) {
  const data = Object.fromEntries([...formData].map(([k,v]) => [k,v.trim()]));
  if (selected === "students" || selected === "users") await saveAccount({...data, role: selected === "students" ? "student" : data.role});
  else if (selected === "offerings") {
    data.components = data.components.split(/\r?\n/).filter(Boolean).map(line => { const [id,label,max] = line.split(",").map(v=>v.trim()); return {id,label,max:Number(max)}; }); await saveOffering(data);
  } else if (selected === "enrollments") await enrollStudent(data.studentId,data.offeringId);
  else if (selected === "settings") {
    for (const key of fields.settings) { const user = await record("users",data[key]); if (user?.role !== (key === "hodId" ? "hod" : key === "officeId" ? "office" : key)) throw new Error(`Choose a valid ${key} account UID.`); }
    await setDoc(doc(db,"settings","workflow"),data);
  } else {
    stableId(data.id);
    if (selected === "subjects" && (!data.name || !data.code)) throw new Error("Subject name and code are required.");
    if (selected === "assignments" && (!data.title || !(await record("offerings",data.offeringId)))) throw new Error("Assignment title and an existing class ID are required.");
    const {id,...payload} = data; await setDoc(doc(db,selected,id),{...payload,updatedAt:serverTimestamp()},{merge:true});
  }
  document.getElementById("saveMessage").textContent = "Saved. Refresh affected student clearance plans after academic changes.";
  await loadList();
}
