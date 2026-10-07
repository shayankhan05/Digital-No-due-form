import {FieldValue} from './values.js';

export const REQUIRED_SERVICES=['library','accounts'];
const text=v=>String(v ?? '').trim();
const department=v=>['ise','information science & engineering','information science and engineering'].includes(text(v).toLowerCase())?'ise':text(v).toLowerCase();
export function matchesStudent(student,offering) {
  return offering.active!==false && Number(offering.semester)===Number(student.semester)
    && text(offering.section).toUpperCase()===text(student.section).toUpperCase()
    && (!text(offering.department) || department(offering.department)===department(student.department))
    && (!text(offering.scheme) || text(offering.scheme)===text(student.scheme));
}
export function subjectItem(uid,student,offering,teacher) {
  return {approverType:'subject_faculty',approverId:offering.teacherId,studentUid:uid,
    offeringId:offering.id,subjectCode:offering.subjectCode,subjectName:offering.subjectName,label:offering.subjectName,
    teacherUid:offering.teacherId,teacherName:teacher.name || '',teacherEmail:teacher.email || '',
    department:student.department || offering.department || '',scheme:text(student.scheme || offering.scheme),
    semester:Number(student.semester),section:text(student.section).toUpperCase()};
}
export async function enrollmentPlan(db,uid) {
  const student=(await db.doc(`students/${uid}`).get()).data(),config=(await db.doc('settings/workflow').get()).data();
  if(!student || !config) throw new Error('Student profile and workflow assignments are required.');
  const enrolled=await db.collection('enrollments').where('studentId','==',uid).where('active','==',true).get();
  const items={};
  for(const row of enrolled.docs) {
    const e=row.data(),snap=await db.doc(`offerings/${e.offeringId}`).get(),o={...snap.data(),id:snap.id};
    if(!snap.exists || !matchesStudent(student,o)) continue;
    const teacher=(await db.doc(`users/${o.teacherId}`).get()).data();
    if(!teacher || !['subject_faculty','mentor'].includes(teacher.role) || e.teacherId!==o.teacherId) throw new Error('An enrolled subject has an invalid teacher mapping. Ask the administrator to refresh it.');
    items[`subject_${o.id}`]={...subjectItem(uid,student,o,teacher),enrollmentId:row.id};
  }
  const count=Object.keys(items).length;
  if(!count || count>30) throw new Error('Assign 1–30 active subjects matching the student academic context.');
  for(const type of REQUIRED_SERVICES) {
    const user=config[type] && (await db.doc(`users/${config[type]}`).get()).data();
    if(user?.role!==type) throw new Error(`Configure the ${type} approver.`);
    items[type]={approverType:type,approverId:config[type],label:type,subjectCode:null,offeringId:null};
  }
  for(const [id,role] of [[student.mentorId,'mentor'],[config.hodId,'hod'],[config.officeId,'office']]) {
    if(!id || (await db.doc(`users/${id}`).get()).data()?.role!==role) throw new Error(`Configure the assigned ${role}.`);
  }
  return {valid:true,workflowVersion:3,items,initialStates:Object.fromEntries(Object.keys(items).map(id=>[id,'pending'])),
    approverIds:[...new Set(Object.values(items).map(item=>item.approverId))],mentorId:student.mentorId,
    hodId:config.hodId,officeId:config.officeId,semester:student.semester,section:student.section};
}
export function migrateRequest(r,plan,projections={}) {
  if(['issued','cleared'].includes(r.status) || r.workflowVersion===3) return null;
  const oldItems=r.approvalItems || Object.fromEntries(Object.entries(projections).map(([id,item])=>[id,item]));
  const oldStates=r.approvalStates || Object.fromEntries(Object.entries(projections).map(([id,item])=>[id,item.status]));
  const states={},sources={};
  for(const [id,item] of Object.entries(plan.items)) {
    const matches=Object.entries(oldItems).filter(([,old])=>old.approverId===item.approverId && old.approverType===item.approverType
      && (item.approverType!=='subject_faculty' || old.offeringId===item.offeringId || (old.subjectCode===item.subjectCode && Object.values(plan.items).filter(i=>i.subjectCode===item.subjectCode && i.approverId===item.approverId).length===1)));
    const source=matches.length===1?matches[0][0]:null;
    sources[id]=source;states[id]=source ? oldStates[source] || 'pending':'pending';
  }
  const remaining=Object.values(states).filter(s=>s!=='approved').length;
  const rejection=Object.keys(states).find(id=>states[id]==='rejected');
  const laterRejected=r.mentorApproval?.status==='rejected' || r.hodApproval?.status==='rejected';
  const status=rejection?'rejected':remaining?'pending_stage1':laterRejected?'rejected':r.status==='pending_hod'?'pending_hod':'pending_mentor';
  return {sources,patch:{schemaVersion:2,workflowVersion:3,approvalItems:plan.items,approvalStates:states,
    resubmissionStates:Object.fromEntries(Object.entries(states).map(([id,s])=>[id,s==='rejected'?'pending':s])),
    approverIds:plan.approverIds,remaining,status,mentorId:plan.mentorId,hodId:plan.hodId,officeId:plan.officeId,
    mentorApproval:r.mentorApproval || {status:'pending',remarks:''},hodApproval:r.hodApproval || {status:'pending',remarks:''},
    lastApprovalId:rejection || '',version:r.version || 0,lastEvent:r.lastEvent || null,
    workflowHistory:{approvalItems:oldItems,approvalStates:oldStates,approvals:projections,status:r.status,remaining:r.remaining ?? null,
      mentorApproval:r.mentorApproval || null,hodApproval:r.hodApproval || null,lastEvent:r.lastEvent || null,previousSchemaVersion:r.schemaVersion || 0}}};
}
export async function syncStudentWorkflow(db,uid) {
  const plan=await enrollmentPlan(db,uid);
  await db.doc(`students/${uid}/clearance/plan`).set({...plan,updatedAt:FieldValue.serverTimestamp()});
  const requests=await db.collection('noDueRequests').where('studentId','==',uid).get();let migrated=0;
  for(const row of requests.docs) {
    await db.runTransaction(async tx=>{
      const fresh=await tx.get(row.ref),approvals=await tx.get(row.ref.collection('approvals'));
      const old=Object.fromEntries(approvals.docs.map(d=>[d.id,d.data()])),change=migrateRequest(fresh.data(),plan,old);
      if(!change) return;
      tx.update(row.ref,change.patch);
      for(const [id,item] of Object.entries(plan.items)) {
        const previous=old[change.sources[id]],existing=old[id];
        // Original projection/history is retained verbatim; enrich an exact item,
        // or create the newly required offering without discarding a decision.
        tx.set(row.ref.collection('approvals').doc(id),{...previous,...item,studentId:uid,studentName:fresh.data().studentName,
          usn:fresh.data().usn,section:plan.section,requestId:row.id,status:change.patch.approvalStates[id],
          remarks:previous?.remarks || '',actedBy:previous?.actedBy || null,actedAt:previous?.actedAt || null,
          ...(existing?{historicalApproval:existing}:{})},{merge:true});
      }
      migrated++;
    });
  }
  return {plan,migrated};
}
