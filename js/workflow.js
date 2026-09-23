import { db } from "./firebase-config.js";
import {
  doc, collection, getDoc, getDocs, updateDoc, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------------------------------------------------------------
// Request status moves through exactly these states, in order.
// A rejection anywhere jumps straight to "rejected".
// ---------------------------------------------------------------
export const STATUS = {
  PENDING_STAGE1: "pending_stage1", // subject faculty + library + labs + accounts (parallel)
  PENDING_MENTOR: "pending_mentor", // soft-skill attestation
  PENDING_HOD: "pending_hod",       // coordinator / HOD sign-off
  CLEARED: "cleared",               // ready for hall ticket
  REJECTED: "rejected",
  ISSUED: "issued",                 // office has handed over the hall ticket
};

export const STAGE1_TYPES = ["subject_faculty", "library", "physics_lab", "chemistry_lab", "accounts"];

// ---------------------------------------------------------------
// Hardcoded per semester/section for now (this is the "workflow config"
// step you deferred to v2 — an admin screen would edit this instead).
// Add more entries as your college needs them.
// ---------------------------------------------------------------
const REQUIRED_APPROVERS_BY_KEY = {
  "6-B": [
    { type: "library", label: "Library" },
    { type: "physics_lab", label: "Physics lab" },
    { type: "chemistry_lab", label: "Chemistry lab" },
    { type: "accounts", label: "Accounts" },
    { type: "subject_faculty", subjectCode: "CS61", label: "Computer Networks" },
    { type: "subject_faculty", subjectCode: "CS62", label: "DBMS" },
    { type: "subject_faculty", subjectCode: "CS63", label: "Software Engineering" },
    { type: "subject_faculty", subjectCode: "CS64", label: "System Software" },
    { type: "subject_faculty", subjectCode: "CS65", label: "Web Technology" },
    { type: "subject_faculty", subjectCode: "CS66", label: "Data Mining" },
    { type: "subject_faculty", subjectCode: "CS67", label: "Cloud Computing" },
    { type: "subject_faculty", subjectCode: "CS68", label: "Open Elective" },
  ],
};

export function getRequiredApprovers(semester, section) {
  return REQUIRED_APPROVERS_BY_KEY[`${semester}-${section}`] || REQUIRED_APPROVERS_BY_KEY["6-B"];
}

/**
 * Creates a new No-Due request plus one approval document per Stage 1 item.
 * Mentor and HOD decisions live directly on the request document (see approveMentor/approveHod)
 * since there's only ever one of each, unlike Stage 1's many parallel items.
 */
export async function submitRequest(student) {
  const requestRef = doc(collection(db, "noDueRequests"));
  const batch = writeBatch(db);

  batch.set(requestRef, {
    studentId: student.uid,
    studentName: student.name,
    usn: student.usn,
    semester: student.semester,
    section: student.section,
    mentorId: student.mentorId || null,
    status: STATUS.PENDING_STAGE1,
    mentorApproval: { status: "pending", remarks: "" },
    hodApproval: { status: "pending", remarks: "" },
    createdAt: serverTimestamp(),
  });

  const required = getRequiredApprovers(student.semester, student.section);
  required.forEach((item) => {
    const approvalRef = doc(collection(requestRef, "approvals"));
    batch.set(approvalRef, {
      approverType: item.type,
      subjectCode: item.subjectCode || null,
      label: item.label,
      status: "pending",
      remarks: "",
      actedBy: null,
      actedAt: null,
      // Denormalized so approver screens can list pending items with one query,
      // instead of a follow-up read to the parent request for every row.
      studentId: student.uid,
      studentName: student.name,
      usn: student.usn,
      section: student.section,
      requestId: requestRef.id,
    });
  });

  await batch.commit();
  return requestRef.id;
}

/** Approve or reject a single Stage 1 item (a subject/library/lab/accounts row). */
export async function actOnStage1Item(requestId, approvalId, decision, remarks, actorName) {
  const approvalRef = doc(db, "noDueRequests", requestId, "approvals", approvalId);
  await updateDoc(approvalRef, {
    status: decision, // "approved" | "rejected"
    remarks: remarks || "",
    actedBy: actorName || null,
    actedAt: serverTimestamp(),
  });
  await checkAndAdvance(requestId);
}

/**
 * Re-evaluates a request's status after a Stage 1 item changes.
 * Called after every Stage 1 approve/reject — there's no server function doing this for us,
 * so the client that just acted is responsible for triggering the check.
 */
export async function checkAndAdvance(requestId) {
  const requestRef = doc(db, "noDueRequests", requestId);
  const approvalsSnap = await getDocs(collection(requestRef, "approvals"));
  const items = approvalsSnap.docs.map((d) => d.data());

  if (items.some((a) => a.status === "rejected")) {
    await updateDoc(requestRef, { status: STATUS.REJECTED });
    return;
  }
  if (items.every((a) => a.status === "approved")) {
    await updateDoc(requestRef, { status: STATUS.PENDING_MENTOR });
  }
}

/** Mentor's soft-skill decision. Only meaningful once status is already PENDING_MENTOR. */
export async function actAsMentor(requestId, decision, remarks) {
  const requestRef = doc(db, "noDueRequests", requestId);
  await updateDoc(requestRef, {
    mentorApproval: { status: decision, remarks: remarks || "" },
    status: decision === "approved" ? STATUS.PENDING_HOD : STATUS.REJECTED,
  });
}

/** HOD / Coordinator's final decision. Only meaningful once status is already PENDING_HOD. */
export async function actAsHod(requestId, decision, remarks) {
  const requestRef = doc(db, "noDueRequests", requestId);
  await updateDoc(requestRef, {
    hodApproval: { status: decision, remarks: remarks || "" },
    status: decision === "approved" ? STATUS.CLEARED : STATUS.REJECTED,
  });
}

/** Office issues the hall ticket. Only enabled in the UI once status is CLEARED. */
export async function issueHallTicket(requestId, issuedBy) {
  const requestRef = doc(db, "noDueRequests", requestId);
  await updateDoc(requestRef, {
    status: STATUS.ISSUED,
    issuedBy: issuedBy || null,
    issuedAt: serverTimestamp(),
  });
}

/**
 * Student resubmits after a rejection. Resets only the item(s) that were rejected —
 * everything already approved stays approved.
 */
export async function resubmit(requestId) {
  const requestRef = doc(db, "noDueRequests", requestId);
  const approvalsSnap = await getDocs(collection(requestRef, "approvals"));
  const rejectedStage1 = approvalsSnap.docs.filter((d) => d.data().status === "rejected");

  if (rejectedStage1.length > 0) {
    const batch = writeBatch(db);
    rejectedStage1.forEach((d) => {
      batch.update(d.ref, { status: "pending", remarks: "" });
    });
    batch.update(requestRef, { status: STATUS.PENDING_STAGE1 });
    await batch.commit();
    return;
  }

  // Otherwise the rejection came from the mentor or HOD stage.
  const requestDoc = await getDoc(requestRef);
  const data = requestDoc.data();

  if (data.mentorApproval?.status === "rejected") {
    await updateDoc(requestRef, {
      mentorApproval: { status: "pending", remarks: "" },
      status: STATUS.PENDING_MENTOR,
    });
  } else if (data.hodApproval?.status === "rejected") {
    await updateDoc(requestRef, {
      hodApproval: { status: "pending", remarks: "" },
      status: STATUS.PENDING_HOD,
    });
  }
}

export function statusLabel(status) {
  const labels = {
    pending_stage1: "In progress",
    pending_mentor: "With mentor",
    pending_hod: "With coordinator",
    cleared: "Cleared",
    rejected: "Rejected",
    issued: "Hall ticket issued",
  };
  return labels[status] || status;
}
/**
  One thing worth remembering for the rest of your testing: whenever you hand-edit an approval's status directly in Firestore instead of clicking the real button, this same thing will happen again — the item looks done, but nothing tells the request
  to move forward. The safest habit from here: always leave the very last item in a stage to approve through the real app button, not through Firestore directly.
  import("./js/workflow.js").then(({ checkAndAdvance }) => {
  checkAndAdvance("8sWKxneDtEddtPZNFOt0").then(() => console.log("Checked — reload the dashboard now."));
});
import("./js/workflow.js").then(({ checkAndAdvance }) => {
  checkAndAdvance("qMXmX56maH44OemNCETb").then(() => console.log("Checked — reload now."));
}); **/