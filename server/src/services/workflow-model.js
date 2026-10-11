export const STATUS = { PENDING_STAGE1: "pending_stage1", PENDING_MENTOR: "pending_mentor", PENDING_HOD: "pending_hod", CLEARED: "cleared", REJECTED: "rejected", ISSUED: "issued" };
export function stage1Change(r, id, decision) {
  const stage1Open = r.status === STATUS.PENDING_STAGE1 || r.status === STATUS.REJECTED && Object.values(r.approvalStates).includes("rejected");
  if (!stage1Open || r.approvalStates[id] !== "pending" || !["approved", "rejected"].includes(decision)) throw new Error("This item is no longer pending at Stage 1.");
  const approvalStates = { ...r.approvalStates, [id]: decision };
  const remaining = Object.values(approvalStates).filter(state => state !== "approved").length;
  return { approvalStates, resubmissionStates: Object.fromEntries(Object.entries(approvalStates).map(([key,state]) => [key,state === "rejected" ? "pending" : state])), remaining, lastApprovalId: id, status: Object.values(approvalStates).includes("rejected") ? STATUS.REJECTED : remaining === 0 ? STATUS.PENDING_MENTOR : STATUS.PENDING_STAGE1 };
}
export function resumeChange(r) {
  if (r.status !== STATUS.REJECTED) throw new Error("Only a rejected request can be resubmitted.");
  const id = Object.keys(r.approvalStates).find(k => r.approvalStates[k] === "rejected");
  if (id) {
    const approvalStates = Object.fromEntries(Object.entries(r.approvalStates).map(([key,value]) => [key,value === "rejected" ? "pending" : value]));
    return { approvalStates, resubmissionStates: {...approvalStates}, remaining: Object.values(approvalStates).filter(value => value !== "approved").length, lastApprovalId: r.lastApprovalId || id, status: STATUS.PENDING_STAGE1 };
  }
  if (r.mentorApproval?.status === "rejected") return { mentorApproval: { status: "pending", remarks: "" }, status: STATUS.PENDING_MENTOR };
  if (r.hodApproval?.status === "rejected") return { hodApproval: { status: "pending", remarks: "" }, status: STATUS.PENDING_HOD };
  // Office processing currently uses the cleared queue, without a separate approval action.
  if (r.officeApproval?.status === "rejected") return { officeApproval: { status: "pending", remarks: "" }, status: STATUS.CLEARED };
  throw new Error("No rejected decision was found.");
}
export function statusLabel(status) { return ({ pending_stage1: "In progress", pending_mentor: "With mentor", pending_hod: "With coordinator", cleared: "Cleared", rejected: "Rejected", issued: "Hall ticket issued" })[status] || status; }
