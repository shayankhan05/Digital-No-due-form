import { db, auth } from "./firebase-config.js";
import { doc, collection, getDoc, getDocs, writeBatch, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { stage1Change, resumeChange, STATUS, statusLabel } from "./workflow-model.js";
export { STATUS, statusLabel };
export const STAGE1_TYPES = ["subject_faculty", "library", "physics_lab", "chemistry_lab", "accounts"];
export async function getRequiredApprovers(uid) {
  const [snap, config] = await Promise.all([getDoc(doc(db, "students", uid, "clearance", "plan")), getDoc(doc(db,"settings","workflow"))]);
  if (!snap.exists() || snap.data().valid !== true) throw new Error("Ask the administrator to prepare your academic clearance plan.");
  const p = snap.data(), c = config.data();
  if (!c || p.hodId !== c.hodId || p.officeId !== c.officeId || ["library","physics_lab","chemistry_lab","accounts"].some(type => p.items[type]?.approverId !== c[type])) throw new Error("Workflow assignments changed. Ask the administrator to refresh your clearance plan.");
  return Object.entries(snap.data().items).map(([id, item]) => ({ id, ...item, type: item.approverType }));
}
export async function submitRequest() {
  const uid = auth.currentUser.uid;
  const [studentSnap, planSnap] = await Promise.all([getDoc(doc(db, "students", uid)), getDoc(doc(db, "students", uid, "clearance", "plan"))]);
  if (!studentSnap.exists() || !planSnap.exists()) throw new Error("Ask the administrator to link your student profile and prepare your clearance plan.");
  const s = studentSnap.data(), p = planSnap.data();
  const ref = doc(collection(db, "noDueRequests")), batch = writeBatch(db);
  batch.set(ref, { schemaVersion: 2, studentId: uid, studentName: s.name, usn: s.usn, semester: s.semester, section: s.section, mentorId: p.mentorId, hodId: p.hodId, officeId: p.officeId, approverIds: p.approverIds, approvalItems: p.items, approvalStates: p.initialStates, resubmissionStates: p.initialStates, remaining: Object.keys(p.items).length, status: STATUS.PENDING_STAGE1, mentorApproval: { status: "pending", remarks: "" }, hodApproval: { status: "pending", remarks: "" }, lastApprovalId: "", version: 0, lastEvent: null, createdAt: serverTimestamp() });
  for (const [id, item] of Object.entries(p.items)) batch.set(doc(ref, "approvals", id), { ...item, status: "pending", remarks: "", actedBy: null, actedAt: null, studentId: uid, studentName: s.name, usn: s.usn, section: s.section, requestId: ref.id });
  await batch.commit(); return ref.id;
}
function validateDecision(decision, remarks) {
  if (!["approved", "rejected"].includes(decision)) throw new Error("Invalid decision.");
  if (decision === "rejected" && !remarks?.trim()) throw new Error("A rejection reason is required.");
  if ((remarks || "").length > 2000) throw new Error("Keep the reason under 2000 characters.");
}
async function changeRequest(requestId, change) {
  const ref = doc(db, "noDueRequests", requestId);
  const actorSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
  const actor = { ...actorSnap.data(), uid: auth.currentUser.uid };
  // Concurrent event versions can be denied by rules before the SDK reports an
  // optimistic conflict. Retry only when a fresh authorized read proves progress.
  for (let attempt = 0; attempt < 5; attempt++) {
  let observedVersion = null;
  try {
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Request not found.");
    const r = snap.data();
    observedVersion = r.version;
    if (r.schemaVersion !== 2) throw new Error("Ask the administrator to upgrade this legacy request before processing.");
    const { patch, approvalId, approvalIds, decision, reason = "", subjectCode = null } = change(r, actor);
    const version = r.version + 1;
    const event = { requestId, studentId: r.studentId, actorId: actor.uid, actorName: actor.name || "", actorType: actor.role, subjectCode, reason, status: patch.status, version, createdAt: serverTimestamp() };
    tx.update(ref, { ...patch, version, lastEvent: event, updatedAt: serverTimestamp() });
    tx.set(doc(db, "users", r.studentId, "notifications", `${requestId}_${version}`), event);
    for (const key of approvalIds || (approvalId ? [approvalId] : [])) tx.set(doc(ref, "approvals", key), { ...r.approvalItems[key], studentId: r.studentId, studentName: r.studentName, usn: r.usn, section: r.section, requestId, status: decision, remarks: reason, actedBy: actor.name || "", actorId: actor.uid, actedAt: serverTimestamp() });
  });
  return;
  } catch (error) {
    if (error.code !== "permission-denied" || observedVersion === null || attempt === 4) throw error;
    const fresh = await getDoc(ref);
    if (!fresh.exists() || fresh.data().version <= observedVersion) throw error;
  }
  }
}
export async function actOnStage1Item(requestId, approvalId, decision, remarks) {
  validateDecision(decision, remarks);
  return changeRequest(requestId, (r, actor) => {
    const item = r.approvalItems[approvalId];
    if (!item || item.approverId !== actor.uid) throw new Error("This approval is not assigned to you.");
    return { patch: stage1Change(r, approvalId, decision), approvalId, decision, reason: (remarks || "").trim(), subjectCode: item.subjectCode || null };
  });
}
export async function checkAndAdvance() { throw new Error("Use the approval action; advancement is atomic."); }
function stageDecision(id, decision, remarks, field, stage, next, role, owner) {
  validateDecision(decision, remarks);
  return changeRequest(id, (r, actor) => {
    if (r.status !== stage || actor.role !== role || r[owner] !== actor.uid) throw new Error("This request is not at your assigned approval stage.");
    return { patch: { [field]: { status: decision, remarks: (remarks || "").trim(), actorId: actor.uid, actedAt: serverTimestamp() }, status: decision === "approved" ? next : STATUS.REJECTED }, reason: (remarks || "").trim() };
  });
}
export const actAsMentor = (id, d, r) => stageDecision(id, d, r, "mentorApproval", STATUS.PENDING_MENTOR, STATUS.PENDING_HOD, "mentor", "mentorId");
export const actAsHod = (id, d, r) => stageDecision(id, d, r, "hodApproval", STATUS.PENDING_HOD, STATUS.CLEARED, "hod", "hodId");
export const issueHallTicket = id => changeRequest(id, (r, actor) => {
  if (r.status !== STATUS.CLEARED || actor.role !== "office" || r.officeId !== actor.uid) throw new Error("Only the assigned office can issue a cleared request.");
  return { patch: { status: STATUS.ISSUED, issuedBy: actor.name, issuedById: actor.uid, issuedAt: serverTimestamp() } };
});
export const resubmit = id => changeRequest(id, (r, actor) => {
  if (r.studentId !== actor.uid) throw new Error("This request does not belong to you.");
  const patch = resumeChange(r);
  const approvalIds = patch.approvalStates ? Object.keys(r.approvalStates).filter(key => r.approvalStates[key] === "rejected") : [];
  return { patch, approvalIds, decision: "pending" };
});
// Explicit admin-only compatibility action; never invoked automatically.
export async function upgradeLegacyRequest(id, plan) {
  const ref = doc(db, "noDueRequests", id);
  const [snap, approvals] = await Promise.all([getDoc(ref), getDocs(collection(ref, "approvals"))]);
  const r = snap.data();
  if (!r || r.schemaVersion === 2) throw new Error("Choose an existing legacy request.");
  const items = {}, states = {}, legacyRejections = [];
  for (const a of approvals.docs) {
    const old = a.data();
    const match = Object.values(plan.items).find(p => p.approverType === old.approverType && (p.subjectCode || null) === (old.subjectCode || null));
    if (!match) throw new Error(`No mapping found for ${old.label}. Correct mappings before upgrading.`);
    items[a.id] = match; states[a.id] = old.status;
    if (old.status === "rejected") legacyRejections.push({approvalId:a.id,actorName:old.actedBy || old.label || old.approverType,actorType:old.approverType,subjectCode:old.subjectCode || null,reason:old.remarks || "Reason was not recorded in this legacy request.",createdAt:old.actedAt || null});
  }
  if (!approvals.size) throw new Error("Legacy request has no approval records.");
  const batch = writeBatch(db);
  batch.update(ref, { schemaVersion: 2, approvalItems: items, approvalStates: states, resubmissionStates: Object.fromEntries(Object.entries(states).map(([key,value]) => [key,value === "rejected" ? "pending" : value])), remaining: Object.values(states).filter(s => s !== "approved").length, approverIds: [...new Set(Object.values(items).map(i => i.approverId))], mentorId: plan.mentorId, hodId: plan.hodId, officeId: plan.officeId, lastApprovalId: Object.keys(states).find(k => states[k] === "rejected") || "", version: 0, lastEvent: null });
  for (const a of approvals.docs) batch.update(a.ref, items[a.id]);
  batch.update(ref,{legacyRejections});
  await batch.commit();
}
