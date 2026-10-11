import {enrollmentPlan} from './clearance.js';
import {resumeChange} from './workflow-model.js';

// Reopen the existing approval IDs. Never rebuild a request from the current plan.
export async function prepareResubmission(tx, request, requestId, stamp) {
  const patch = resumeChange(request);
  const keys = Object.keys(request.approvalStates || {}).filter(key => request.approvalStates[key] === 'rejected');
  const plan = await enrollmentPlan(tx.store, request.studentId);
  const targets = [];
  const history = [...(request.rejectionHistory || [])];
  for (const key of keys) {
    const item = request.approvalItems[key], current = plan.items[key];
    if (!item || !current || item.approverId !== current.approverId || item.offeringId !== current.offeringId) {
      throw new Error('A rejected approval mapping has changed. Ask the administrator to review it before resubmitting.');
    }
    const ref = tx.store.doc(`noDueRequests/${requestId}/approvals/${key}`);
    const previous = (await tx.get(ref)).data();
    if (!previous || previous.status !== 'rejected') throw new Error('The rejected approval record is inconsistent. Ask the administrator to review it.');
    const {history: previousHistory = [], ...decision} = previous;
    const archived = {...decision, resubmittedAt: stamp};
    // Keep prior decision metadata verbatim in history; only clear the active decision.
    tx.update(ref, {status: 'pending', remarks: '', actedBy: null, actorId: null, actedAt: null,
      history: [...previousHistory, archived], resubmittedAt: stamp});
    history.push({approvalId: key, ...archived});
    targets.push({approvalId: key, approverId: item.approverId, subjectCode: item.subjectCode || null, label: item.label});
  }
  if (!keys.length) {
    const stage = ['mentor', 'hod', 'office'].find(stage => request[`${stage}Approval`]?.status === 'rejected');
    const owner = `${stage}Id`;
    if (!stage || request[owner] !== plan[owner]) throw new Error('The rejected stage mapping has changed. Ask the administrator to review it before resubmitting.');
    history.push({stage, ...request[`${stage}Approval`], resubmittedAt: stamp});
    targets.push({approvalId: stage, approverId: request[owner], subjectCode: null, label: stage});
  }
  return {patch: {...patch, rejectionHistory: history,
    lastResubmission: {rejectedVersion: request.version || 0, approvalIds: targets.map(target => target.approvalId), labels: targets.map(target => target.label), at: stamp}}, targets};
}
