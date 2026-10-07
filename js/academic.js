import { db } from "./firebase-config.js";
import { collection, doc, getDoc, getDocs, query, where, limit, orderBy, startAfter, setDoc, serverTimestamp } from "./api-store.js";
import { escapeHtml as e, profileHTML } from "./ui.js";

export async function record(collectionName, id) {
  if (!id) return null;
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? { ...snap.data(), id: snap.id } : null;
}
export async function page(collectionName, filters = [], cursor = null, size = 30) {
  const clauses = filters.map(([key, op, value]) => where(key, op, value));
  const snap = await getDocs(query(collection(db, collectionName), ...clauses, orderBy("__name__"), ...(cursor ? [startAfter(cursor)] : []), limit(size)));
  return { rows: snap.docs.map(d => ({ ...d.data(), id: d.id })), cursor: snap.cursor || snap.docs.at(-1), more: snap.more ?? snap.size === size };
}
export async function studentProfile(uid, fallback = {}) {
  return { ...fallback, ...(await record("students", uid) || {}), uid };
}
export async function academicDetails(uid) {
  const student = await studentProfile(uid);
  const [mentor, enrollments] = await Promise.all([record("users", student.mentorId), page("enrollments", [["studentId", "==", uid], ["active", "==", true]], null, 31)]);
  const subjects = await Promise.all(enrollments.rows.map(async enrollment => {
    const [offering, marks] = await Promise.all([record("offerings", enrollment.offeringId), record("marks", enrollment.id)]);
    if (!offering) return { enrollment, offering: {}, marks: null, assignments: [] };
    const [teacher, assignments] = await Promise.all([record("users", offering.teacherId), page("assignments", [["offeringId", "==", offering.id]], null, 50)]);
    return { enrollment, offering, teacher, marks, assignments: assignments.rows };
  }));
  return { student, mentor, subjects: subjects.filter(({offering})=>offering.active!==false) };
}
export function academicHTML(details) {
  return `${profileHTML(details.student)}<div class="card"><h2>Mentor</h2>${details.mentor ? `${e(details.mentor.name)}<br>${e(details.mentor.email)}<br>${e(details.mentor.phone)}` : "No mentor linked. Contact the administrator."}</div>
    <div class="card"><h2>Subjects & Marks</h2><p class="muted">Academic marks are read-only for students and mentors.</p>${details.subjects.length ? details.subjects.map(({offering, teacher, marks, assignments}) => `<section class="academic-subject"><h3>${e(offering.subjectName)} · ${e(offering.subjectCode)}</h3><p>Teacher: ${e(teacher?.name || "Not linked")}</p><div class="table-scroll"><table><thead><tr><th>Assessment</th><th>Marks</th><th>Maximum</th></tr></thead><tbody>${(offering.components || []).map(component => `<tr><td>${e(component.label)}</td><td>${e(marks?.scores?.[component.id] ?? "Not entered")}</td><td>${e(component.max)}</td></tr>`).join("")}</tbody></table></div><h4>Assignments</h4>${assignments.length ? assignments.map(a => `<article class="banner"><strong>${e(a.title)}</strong><p>${e(a.description)}</p><small>Due: ${e(a.dueDate || "Not specified")} · ${e(a.status || "Assigned")}</small></article>`).join("") : '<p class="muted">No assignments published.</p>'}</section>`).join("") : '<p>No subjects assigned. Contact the administrator.</p>'}</div>`;
}
export async function saveMarks(enrollment, offering, scores, actorId) {
  for (const component of offering.components || []) {
    const value = scores[component.id];
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > component.max)) throw new Error(`${component.label}: enter marks between 0 and ${component.max}.`);
  }
  await setDoc(doc(db, "marks", enrollment.id), { studentId: enrollment.studentId, offeringId: offering.id, teacherId: offering.teacherId, mentorId: enrollment.mentorId, subjectId: offering.subjectId, subjectCode: offering.subjectCode, semester: offering.semester, section: offering.section, scores, updatedBy: actorId, updatedAt: serverTimestamp() });
}
