import {isMentor,isFaculty} from '../../../js/capabilities.js';
import {isInactive} from './account-removal.js';
import {randomUUID,createHash} from 'node:crypto';
import {enrollmentPlan,syncStudentWorkflow} from './clearance.js';
import {stage1Change,STATUS} from './workflow-model.js';
import {prepareResubmission} from './resubmission.js';
const fail=message=>{throw Object.assign(new Error(message),{code:'permission-denied'});};
export const ACTIVE_STATUSES=['pending_stage1','pending_mentor','pending_hod','pending_office','cleared','rejected'];
export const ACTIVE_MESSAGE='You already have an active No-Due request. Please complete or resolve the existing request before creating another.';
export async function submitRequest(store,actor,requestKey){
 if(actor.role!=='student')fail('Only students submit requests.');if(requestKey!==undefined&&!/^[A-Za-z0-9_-]{8,100}$/.test(requestKey))throw new Error('Invalid submission key.');
 const id=requestKey?createHash('sha256').update(actor.uid+':'+requestKey).digest('hex').slice(0,40):randomUUID();
 await syncStudentWorkflow(store,actor.uid);const plan=await enrollmentPlan(store,actor.uid);let reused=false;
 await store.runTransaction(async tx=>{const ref=store.doc(`noDueRequests/${id}`),same=await tx.get(ref);if(same.exists){reused=true;return;}
 const studentRef=store.doc(`students/${actor.uid}`),student=(await tx.get(studentRef)).data(),active=await tx.get(store.collection('noDueRequests').where('studentId','==',actor.uid).where('status','in',ACTIVE_STATUSES));
 if(isInactive(student))fail('Inactive students cannot submit requests.');
 if(!active.empty)throw Object.assign(new Error(ACTIVE_MESSAGE),{code:'already-exists'});
 // Every competing create writes the same student guard: Mongo retries the
 // losing transaction, which then sees the winning active request.
 tx.update(studentRef,{requestRevision:(student.requestRevision||0)+1});
 const request={schemaVersion:2,workflowVersion:3,studentId:actor.uid,studentName:student.name,usn:student.usn,semester:student.semester,section:student.section,mentorId:plan.mentorId,hodId:plan.hodId,officeId:plan.officeId,approverIds:plan.approverIds,approvalItems:plan.items,approvalStates:plan.initialStates,resubmissionStates:plan.initialStates,remaining:Object.keys(plan.items).length,status:STATUS.PENDING_STAGE1,mentorApproval:{status:'pending',remarks:''},hodApproval:{status:'pending',remarks:''},version:0,lastApprovalId:'',lastEvent:null,createdAt:new Date()};
 tx.create(ref,request);for(const [key,item]of Object.entries(plan.items))tx.create(store.doc(`noDueRequests/${id}/approvals/${key}`),{...item,status:'pending',remarks:'',actedBy:null,actedAt:null,studentId:actor.uid,studentName:student.name,usn:student.usn,section:student.section,requestId:id});});return {id,reused};
}
export async function requestAction(store,actor,id,input){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))fail('Invalid request.');const action=input.action,decision=input.decision,reason=String(input.reason||'').trim();if(reason.length>2000||['stage1','mentor','hod'].includes(action)&&(!['approved','rejected'].includes(decision)||decision==='rejected'&&!reason))throw Object.assign(new Error('A valid decision and rejection reason are required.'),{code:'invalid-argument'});
  await store.runTransaction(async tx=>{const ref=store.doc(`noDueRequests/${id}`),r=(await tx.get(ref)).data();if(!r)fail('Request not found.');let patch,key,keys=[],reopened=[];
    if(action==='stage1'){key=input.approvalId;const item=r.approvalItems?.[key];if(!item||item.approverId!==actor.uid||!(isFaculty(actor)||['library','accounts'].includes(actor.role))||!['subject_faculty','library','accounts'].includes(item.approverType))fail('This item is not assigned to you.');if(item.approverType==='subject_faculty'){const plan=await enrollmentPlan(tx.store,r.studentId);if(plan.items[key]?.approverId!==actor.uid||plan.items[key]?.offeringId!==item.offeringId)fail('Teacher offering changed. Refresh the mapping.');}if(r.approvalStates[key]===decision)return;patch=stage1Change(r,key,decision);keys=[key];}
    else if(action==='mentor'||action==='hod'){if(action==='hod'&&actor.departmentId){const leaderRef=store.doc('departments/'+actor.departmentId),leader=(await tx.get(leaderRef)).data();if(!leader||leader.hodId!==actor.uid)fail('You are not the current department HOD.');tx.update(leaderRef,{hodActionRevision:(leader.hodActionRevision||0)+1});}const mentor=action==='mentor',owner=mentor?'mentorId':'hodId',field=mentor?'mentorApproval':'hodApproval',stage=mentor?'pending_mentor':'pending_hod';if((mentor?!isMentor(actor):actor.role!==action)||r[owner]!==actor.uid)fail('This request is not assigned to you.');if(r[field]?.status===decision)return;if(r.status!==stage)fail('This request is not at your assigned stage.');patch={[field]:{status:decision,remarks:reason,actorId:actor.uid,actedAt:new Date()},status:decision==='rejected'?'rejected':mentor?'pending_hod':'cleared'};}
    else if(action==='issue'){if(actor.role!=='office'||r.officeId!==actor.uid)fail('Only assigned Office can issue a cleared request.');if(r.status==='issued')return;if(r.status!=='cleared')fail('Only assigned Office can issue a cleared request.');patch={status:'issued',issuedBy:actor.name,issuedById:actor.uid,issuedAt:new Date()};tx.create(store.doc(`hallTickets/${id}`),{requestId:id,studentId:r.studentId,usn:r.usn,issuedById:actor.uid,issuedAt:patch.issuedAt});}
    else if(action==='resubmit'){
      if(actor.role!=='student'||r.studentId!==actor.uid)fail('This request does not belong to you.');
      if(input.version!==undefined&&(!Number.isSafeInteger(input.version)||input.version<0))throw new Error('Invalid resubmission version.');
      // Duplicate/stale clicks must not reopen a later rejection or emit new notifications.
      if(r.lastResubmission&&(r.status!=='rejected'||input.version!==undefined&&input.version<=r.lastResubmission.rejectedVersion))return;
      if(input.version!==undefined&&input.version!==(r.version||0))throw new Error('Request changed. Refresh before resubmitting.');
      const retry=await prepareResubmission(tx,r,id,new Date());patch=retry.patch;reopened=retry.targets;
    }
    else fail('Unknown request action.');
    const version=(r.version||0)+1,event={requestId:id,studentId:r.studentId,actorId:actor.uid,actorName:actor.name||'',actorType:actor.role,subjectCode:key?r.approvalItems[key].subjectCode||null:null,approvalId:key||null,offeringId:key?r.approvalItems[key].offeringId||null:null,action,decision:decision||null,reason,status:patch.status,version,createdAt:new Date(),...(action==='issue'?{type:'hall_ticket_issued',message:'Your hall ticket has been issued. Please collect it from the office.',read:false}:{})};
    // The latest sibling action can be an approval while the request still needs a retry.
    // Keep the outstanding rejection separate from the latest activity/notification.
    const lastRejection=decision==='rejected'?event:patch.status==='rejected'?(r.lastRejection||(r.lastEvent?.reason&&r.lastEvent.status==='rejected'?r.lastEvent:null)):null;
    tx.update(ref,{...patch,version,lastEvent:event,lastRejection,updatedAt:new Date()});tx.set(store.doc(`users/${r.studentId}/notifications/${id}_${version}`),event);for(const k of keys)tx.set(store.doc(`noDueRequests/${id}/approvals/${k}`),{...r.approvalItems[k],studentId:r.studentId,studentName:r.studentName,usn:r.usn,section:r.section,requestId:id,status:decision,remarks:reason,actedBy:actor.name||'',actorId:actor.uid,actedAt:new Date()},{merge:true});
    for(const target of reopened)tx.set(store.doc(`users/${target.approverId}/notifications/${id}_${version}_${target.approvalId}`),{...event,...target,type:'approval_resubmitted',reason:'',message:`Resubmitted for ${target.label}`});
  });return {saved:true};
}
