import {roleLabel} from './display-labels.js';
import { db } from "./firebase-config.js";
import { collection, getDocs, query, orderBy, limit } from "./api-store.js";
import { escapeHtml as e } from "./ui.js";
import { statusLabel } from "./workflow-model.js";
export async function loadNotifications(uid) {
  const snap = await getDocs(query(collection(db, "users", uid, "notifications"), orderBy("createdAt", "desc"), limit(30)));
  return snap.docs.map(d => d.data());
}
export function notificationHTML(rows) {
  return `<div class="card"><h2>Notifications</h2>${rows.length ? rows.map(n => `<article class="banner"><strong>${e(n.decision === 'approved' ? 'Approved' : statusLabel(n.decision || n.status))}</strong>${n.message?`<p>${e(n.message)}</p>`:''}<p>${e(n.actorName)} · ${e(roleLabel(n.approvalType||n.actorType))} ${e(n.subjectCode || "")}</p>${n.reason ? `<p>Reason: ${e(n.reason)}</p>` : ""}<small>${e(n.createdAt?.toDate?.().toLocaleString() || "")} · Request ${e(n.requestId)}</small></article>`).join("") : '<p class="muted">No notifications yet.</p>'}</div>`;
}
export function approvalHTML(r) {
  const rows = Object.entries(r.approvalItems || {}).filter(([,item])=>['subject_faculty','library','accounts','physics_lab','chemistry_lab','sports'].includes(item.approverType)).map(([id, item]) => `<div class="row"><span>${e(item.label)} · ${e(item.subjectCode || "")}${item.teacherName ? `<br>Teacher: ${e(item.teacherName)}`:''}</span><span class="badge">${e(r.approvalStates[id])}</span></div>`).join("");
  const legacy = (r.legacyRejections || []).map(n => `<div class="banner"><strong>Rejected by ${e(n.actorName)} · ${e(roleLabel(n.approvalType||n.actorType))} ${e(n.subjectCode || "")}</strong><p>Reason: ${e(n.reason)}</p></div>`).join("");
  const rejectionEvent = r.lastRejection || r.lastEvent;
  const rejection = r.status === "rejected" && rejectionEvent?.reason ? `<div class="banner"><strong>Rejected by ${e(rejectionEvent.actorName)} · ${e(roleLabel(rejectionEvent.approvalType||rejectionEvent.actorType))} ${e(rejectionEvent.subjectCode || "")}</strong><p>Reason: ${e(rejectionEvent.reason)}</p></div>` : r.status === "rejected" ? `${legacy}<p>${e(r.mentorApproval?.remarks || r.hodApproval?.remarks || (legacy ? "" : "Reason was not recorded in this legacy request."))}</p>` : "";
  const subject=rejectionEvent?.subjectCode ? Object.values(r.approvalItems || {}).find(i=>i.subjectCode===rejectionEvent.subjectCode && i.approverId===rejectionEvent.actorId):null;
  return `${rejection}${subject && r.status==='rejected' ? `<p>${e(subject.subjectCode)} — ${e(subject.subjectName || subject.label)}</p>`:''}${rows}<div class="row">Mentor: ${e(r.mentorApproval?.status)} · HOD: ${e(r.hodApproval?.status)}</div>`;
}
