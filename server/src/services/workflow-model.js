export const STATUS = { PENDING_STAGE1: "pending_stage1", PENDING_MENTOR: "pending_mentor", PENDING_HOD: "pending_hod", CLEARED: "cleared", REJECTED: "rejected", ISSUED: "issued" };
export function stage1Change(r, id, decision) {
  if (r.status !== STATUS.PENDING_STAGE1 || r.approvalStates[id] !== "pending" || !["approved", "rejected"].includes(decision)) throw new Error("This item is no longer pending at Stage 1.");
  const remaining = r.remaining - (decision === "approved" ? 1 : 0);
  const approvalStates = { ...r.approvalStates, [id]: decision };
  return { approvalStates, resubmissionStates: {...approvalStates, [id]: decision === "rejected" ? "pending" : decision}, remaining, lastApprovalId: id, status: decision === "rejected" ? STATUS.REJECTED : remaining === 0 ? STATUS.PENDING_MENTOR : STATUS.PENDING_STAGE1 };
}
export function resumeChange(r) {
  if (r.status !== STATUS.REJECTED) throw new Error("Only a rejected request can be resubmitted.");
  const id = Object.keys(r.approvalStates).find(k => r.approvalStates[k] === "rejected");
  if (id) return { approvalStates: Object.fromEntries(Object.entries(r.approvalStates).map(([key,value]) => [key,value === "rejected" ? "pending" : value])), lastApprovalId: r.lastApprovalId || id, status: STATUS.PENDING_STAGE1 };
  if (r.mentorApproval.status === "rejected") return { mentorApproval: { status: "pending", remarks: "" }, status: STATUS.PENDING_MENTOR };
  if (r.hodApproval.status === "rejected") return { hodApproval: { status: "pending", remarks: "" }, status: STATUS.PENDING_HOD };
  throw new Error("No rejected decision was found.");
}
export function statusLabel(status) { return ({ pending_stage1: "In progress", pending_mentor: "With mentor", pending_hod: "With coordinator", cleared: "Cleared", rejected: "Rejected", issued: "Hall ticket issued" })[status] || status; }
