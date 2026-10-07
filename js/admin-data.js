import { db } from "./firebase-config.js";
import { doc, writeBatch, setDoc, serverTimestamp, arrayRemove } from "./api-store.js";
import { page, record } from "./academic.js";
export const ROLES = ["student", "subject_faculty", "mentor", "hod", "office", "library", "physics_lab", "chemistry_lab", "accounts", "admin"];
export const SERVICES = ["library", "accounts"];
export function stableId(value) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value || "")) throw new Error("IDs must contain 1–128 letters, numbers, hyphens or underscores.");
  return value;
}
async function requireRole(uid, roles) {
  const user = await record("users", uid);
  if (!user || !roles.includes(user.role)) throw new Error(`Account ${uid} must have role ${roles.join(" or ")}.`);
  return user;
}
export async function saveAccount(data) {
  const uid = stableId(data.uid);
  if (!ROLES.includes(data.role) || !data.name || !data.email) throw new Error("Name, email and a valid role are required.");
  const batch = writeBatch(db);
  const profile = { name: data.name, email: data.email, phone: data.phone || "", department: data.department || "", facultyId: data.facultyId || "", role: data.role, updatedAt: serverTimestamp() };
  if (data.scheme !== undefined) profile.scheme = data.scheme;
  batch.set(doc(db, "users", uid), profile, { merge: true });
  if (data.role === "student") {
    if (!data.usn || !data.section || !Number.isInteger(Number(data.semester)) || Number(data.semester) < 1 || Number(data.semester) > 12) throw new Error("Student USN, semester (1–12), section and mentor are required.");
    await requireRole(data.mentorId, ["mentor"]);
    batch.set(doc(db, "students", uid), { uid, ...profile, usn: data.usn, semester: Number(data.semester), section: data.section, mentorId: data.mentorId, updatedAt: serverTimestamp() }, { merge: true });
    batch.set(doc(db, "students", uid, "clearance", "plan"), { valid: false }, { merge: true });
  }
  await batch.commit();
}
export async function saveOffering(data) {
  stableId(data.id);
  const subject = await record("subjects", data.subjectId);
  if (!subject) throw new Error("Create the subject first.");
  await requireRole(data.teacherId, ["subject_faculty", "mentor"]);
  const components = data.components;
  if (!components.length || components.length > 10 || new Set(components.map(c => c.id)).size !== components.length || components.some(c => !/^[A-Za-z0-9_-]+$/.test(c.id) || !c.label || !Number.isFinite(c.max) || c.max <= 0)) throw new Error("Provide 1–10 unique assessment IDs, labels and positive maximum marks.");
  if (!Number.isInteger(Number(data.semester)) || !data.section) throw new Error("Semester and section are required.");
  // Invalidate only students enrolled in this class before changing a trusted mapping.
  const previous = await record("offerings", data.id);
  if (previous) {
    let cursor = null, more = true;
    while (more) {
      const result = await page("enrollments", [["offeringId", "==", data.id]], cursor);
      const batch = writeBatch(db);
      for (const uid of new Set(result.rows.map(e => e.studentId))) {
        batch.set(doc(db,"students",uid,"clearance","plan"),{valid:false},{merge:true});
        batch.update(doc(db,"students",uid),{teacherIds:arrayRemove(previous.teacherId)});
      }
      if (result.rows.length) await batch.commit();
      cursor = result.cursor; more = result.more;
    }
  }
  const extra = {};
  if (data.department) extra.department = data.department;
  if (data.scheme) extra.scheme = data.scheme;
  extra.active = data.active !== undefined ? data.active !== false && data.active !== "false" : previous?.active ?? true;
  await setDoc(doc(db, "offerings", data.id), { subjectId: data.subjectId, subjectCode: subject.code, subjectName: subject.name, semester: Number(data.semester), section: data.section, teacherId: data.teacherId, components, componentIds: components.map(c => c.id), ...extra, updatedAt: serverTimestamp() }, { merge: true });
}
export async function enrollStudent(studentId, offeringId) {
  stableId(studentId); stableId(offeringId);
  const [student, offering] = await Promise.all([record("students", studentId), record("offerings", offeringId)]);
  if (!student || !offering || student.semester !== offering.semester || student.section !== offering.section) throw new Error("Student and class must have the same semester and section.");
  const id = `${studentId}__${offeringId}`;
  const batch = writeBatch(db);
  batch.set(doc(db, "enrollments", id), { studentId, offeringId, teacherId: offering.teacherId, mentorId: student.mentorId, semester: offering.semester, section: offering.section, subjectId: offering.subjectId, subjectCode: offering.subjectCode, active: true }, { merge: true });
  batch.set(doc(db,"students",studentId,"clearance","plan"),{valid:false},{merge:true});
  await batch.commit();
  await preparePlan(studentId);
}
export async function preparePlan(uid) {
  const [student, config, enrollments] = await Promise.all([record("students", uid), record("settings", "workflow"), page("enrollments", [["studentId", "==", uid], ["active", "==", true]], null, 31)]);
  if (enrollments.rows.length > 30) throw new Error("A student can have at most 30 active subject enrollments.");
  if (!student || !config) throw new Error("Create the student and workflow assignments first.");
  await requireRole(uid, ["student"]); await requireRole(student.mentorId, ["mentor"]);
  await requireRole(config.hodId, ["hod"]); await requireRole(config.officeId, ["office"]);
  const items = {}, initialStates = {}, offeringIds = [], teacherIds = [];
  const batch = writeBatch(db);
  for (const type of SERVICES) {
    await requireRole(config[type], [type]);
    items[type] = { approverType: type, approverId: config[type], label: type.replaceAll("_", " "), subjectCode: null, offeringId: null };
  }
  for (const enrollment of enrollments.rows.filter(e => e.active !== false)) {
    const offering = await record("offerings", enrollment.offeringId);
    if (!offering || offering.active===false || Number(offering.semester)!==Number(student.semester) || String(offering.section).trim().toUpperCase()!==String(student.section).trim().toUpperCase()) continue;
    const department=v=>['ise','information science & engineering','information science and engineering'].includes(String(v || '').trim().toLowerCase())?'ise':String(v || '').trim().toLowerCase();
    if(offering.department && department(offering.department)!==department(student.department) || offering.scheme && String(offering.scheme).trim()!==String(student.scheme || '').trim()) continue;
    await requireRole(offering.teacherId, ["subject_faculty", "mentor"]);
    offeringIds.push(offering.id); teacherIds.push(offering.teacherId);
    const teacher=await record("users",offering.teacherId);
    items[`subject_${offering.id}`] = { approverType: "subject_faculty", approverId: offering.teacherId, label: offering.subjectName, subjectCode: offering.subjectCode, offeringId: offering.id,
      studentUid:uid,enrollmentId:enrollment.id,subjectName:offering.subjectName,teacherUid:offering.teacherId,teacherName:teacher.name || '',teacherEmail:teacher.email || '',
      department:student.department || offering.department || '',scheme:String(student.scheme || offering.scheme || '').trim(),semester:Number(student.semester),section:String(student.section).trim().toUpperCase() };
    batch.update(doc(db, "enrollments", enrollment.id), { teacherId: offering.teacherId, mentorId: student.mentorId, semester: student.semester, section: student.section });
  }
  if (!offeringIds.length || offeringIds.length > 30) throw new Error("Assign 1–30 current subjects before preparing clearance.");
  for (const key of Object.keys(items)) initialStates[key] = "pending";
  const plan = { valid: true, items, initialStates, approverIds: [...new Set(Object.values(items).map(i => i.approverId))], mentorId: student.mentorId, hodId: config.hodId, officeId: config.officeId, semester: student.semester, section: student.section, updatedAt: serverTimestamp() };
  batch.update(doc(db, "students", uid), { offeringIds, teacherIds: [...new Set(teacherIds)] });
  batch.set(doc(db, "students", uid, "clearance", "plan"), plan);
  await batch.commit(); return plan;
}
