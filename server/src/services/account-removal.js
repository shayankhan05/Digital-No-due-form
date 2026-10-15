import {isMentor} from '../../../js/capabilities.js';
import {authorizeAccountTarget} from './department-master.js';
import {isManager} from './roles.js';
import {randomUUID} from 'node:crypto';
import {DocumentStore} from './document-store.js';
import {officeSearchDocument} from './office-search.js';
import {departmentLabel} from '../../../js/department.js';
export const isInactive = profile => ['inactive','deleted','deactivating','deleting'].includes(profile?.accountStatus);
const fail = (message,code='invalid-argument') => {throw Object.assign(new Error(message),{code});};
const pendingStatuses=['pending_stage1','pending_mentor','pending_hod','pending_office','rejected','cleared'];
export const facultyRoles=['subject_faculty','mentor','hod','office','library','accounts','physics_lab','chemistry_lab'];

async function exitIdentity(database,uid,{profile,student,offerings,blockers}){
 const mentor=student?.mentorId?await database.collection('users').findOne({_id:student.mentorId}):null;
 const enrolled=student?await database.collection('enrollments').find({studentId:uid,active:true}).toArray():[];
 const subjects=[];
 for(const e of enrolled){const o=await database.collection('offerings').findOne({_id:e.offeringId});if(!o||o.active===false)continue;const teacher=await database.collection('users').findOne({_id:o.teacherId});subjects.push({offeringId:o._id,code:o.subjectCode||e.subjectCode,subject:o.subjectName,teacherName:teacher?.name||'Not available',teacherEmail:teacher?.email||'',semester:o.semester,section:o.section,scheme:o.scheme});}
 const classes=[];for(const o of offerings)classes.push({id:o._id,subject:o.subjectName,code:o.subjectCode,semester:o.semester,section:o.section,scheme:o.scheme,studentsEnrolled:await database.collection('enrollments').countDocuments({offeringId:o._id,active:true})});
 const request=student?(await database.collection('noDueRequests').find({studentId:uid,status:{$in:pendingStatuses}}).sort({createdAt:-1,_id:-1}).limit(1).next()||await database.collection('noDueRequests').find({studentId:uid}).sort({createdAt:-1,_id:-1}).limit(1).next()):null;
 return {uid,name:profile.name,email:profile.email,phone:student?.phone||profile.phone||'',role:profile.role,department:student?.department||profile.department,identifier:student?.usn||profile.facultyId,semester:student?.semester,section:student?.section,scheme:student?.scheme,admissionDate:student?.admissionDate||profile.admissionDate||null,mentor:mentor?{name:mentor.name,email:mentor.email}:null,subjects,accountStatus:profile.accountStatus||'active',offerings:classes,blockers,request:request?{id:request._id,status:request.status}:null,hallTickets:student?await database.collection('hallTickets').countDocuments({studentId:uid}):0};
}

// All exit management operations use the same admin-only endpoint/removal service.
export async function accountExit({database,client,auth,actor,input={},restoreStudent}){
 const administrator=await database.collection('users').findOne({_id:actor.uid});
 if(!isManager(administrator?.role)||isInactive(administrator))fail('Administrator access required.','permission-denied');
 const action=input.action||'remove';if(input.uid)await authorizeAccountTarget(database,actor,await database.collection('users').findOne({_id:input.uid}));
 if(['remove','preview'].includes(action))return accountRemoval({database,client,auth,actor,uid:input.uid,confirmation:input.confirmation,preview:action==='preview'||input.preview===true});
 if(!['student','faculty'].includes(input.kind))fail('Choose student or faculty.');
 const roles=input.kind==='student'?['student']:facultyRoles;
 if(action==='lookup'){
  const value=String(input.value||'').trim();if(!value||value.length>200)fail('Enter a USN, employee ID or college email.');
  const query={role:{$in:roles},[value.includes('@')?'email':input.kind==='student'?'usn':'facultyId']:value};
  let profiles;if(input.kind==='student'&&!value.includes('@')){const students=await database.collection('students').find({usn:value}).collation({locale:'en',strength:2}).limit(2).toArray();profiles=await database.collection('users').find({_id:{$in:students.map(s=>s._id)},role:'student'}).toArray();}
  else profiles=await database.collection('users').find(query).collation({locale:'en',strength:2}).limit(2).toArray();
  if(actor.managementDepartmentId)profiles=profiles.filter(p=>p.departmentId===actor.managementDepartmentId);if(profiles.length>1)fail('Identity is ambiguous; resolve duplicate records before exit management.','failed-precondition');
  return {account:profiles.length?await accountRemoval({database,client,auth,actor,uid:profiles[0]._id,preview:true}):null};
 }
 if(['directory','export'].includes(action)){
  const status=input.status||'active';if(!['active','inactive','all'].includes(status))fail('Choose Active, Inactive or All.');
  const filter={role:{$in:roles},...(actor.managementDepartmentId?{departmentId:actor.managementDepartmentId}:{})};if(status!=='all')filter.accountStatus=status==='active'?{$nin:['inactive','deleted','deactivating']}:{$in:['inactive','deleted','deactivating']};
  if(input.cursor){if(!/^[A-Za-z0-9_-]{1,128}$/.test(input.cursor))fail('Invalid directory cursor.');filter._id={$gt:input.cursor};}
  const maximum=action==='export'?10001:51,profiles=await database.collection('users').find(filter).sort({_id:1}).limit(maximum).toArray();
  if(action==='export'&&profiles.length>10000)fail('Export exceeds 10,000 accounts; use a smaller directory scope.');
  const more=action==='directory'&&profiles.length>50,selected=more?profiles.slice(0,50):profiles,rows=[];
  for(const p of selected){const s=p.role==='student'?await database.collection('students').findOne({_id:p._id}):null;const offerings=p.role==='student'?[]:await database.collection('offerings').find({teacherId:p._id,active:{$ne:false}}).toArray();rows.push({uid:p._id,name:p.name,email:p.email,phone:s?.phone||p.phone||'',identifier:s?.usn||p.facultyId||'',department:s?.department||p.department||'',semester:s?.semester??'',section:s?.section||'',scheme:s?.scheme||'',role:p.role,subjects:offerings.map(o=>`${o.subjectCode} ${o.subjectName} (Sem ${o.semester}, ${o.section})`).join(' | '),accountStatus:p.accountStatus||'active'});}
  if(action==='directory')return {rows,more,cursor:more?rows.at(-1).uid:null};
  const headers=['name',input.kind==='student'?'usn':'employeeId','collegeEmail','phone','department','semester','section','scheme','role','assignedSubjects','status'];
  const quote=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  return {filename:`${status}-${input.kind==='student'?'students':'faculty'}.csv`,count:rows.length,csv:'\uFEFF'+[headers,...rows.map(r=>[r.name,r.identifier,r.email,r.phone,departmentLabel(r.department),r.semester,r.section,r.scheme,r.role,r.subjects,r.accountStatus])].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n'};
 }
 if(action==='reactivate')return reactivateAccount({database,client,auth,actor,uid:input.uid,confirmation:input.confirmation,kind:input.kind,restoreStudent});
 fail('Unknown exit management operation.');
}

async function reactivateAccount({database,client,auth,actor,uid,confirmation,kind,restoreStudent}){
 if(typeof uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(uid)||confirmation!=='REACTIVATE')fail('Type REACTIVATE to confirm reactivation of the existing identity.');
 let profile,operationId;const session=client.startSession();
 try{await session.withTransaction(async()=>{
  profile=await database.collection('users').findOne({_id:uid},{session});
  if(!profile||(kind==='student'?profile.role!=='student':!facultyRoles.includes(profile.role)))fail('Select an existing matching identity.');
  if(!isInactive(profile))return;
  if(profile.accountStatus!=='inactive')fail('Finish pending deactivation before reactivating this identity.');
  const identity=await auth.getUser(uid);if(identity.email?.toLowerCase()!==profile.email?.toLowerCase())fail('Authentication identity does not match the retained profile.');
  const same=await database.collection('users').find({email:profile.email,_id:{$ne:uid}}).collation({locale:'en',strength:2}).limit(1).toArray();if(same.length)fail('Email conflicts with another institutional identity.');
  const student=profile.role==='student'?await database.collection('students').findOne({_id:uid},{session}):null;
  if(profile.role==='student'&&!student)fail('Student profile is missing; review the identity before reactivation.');
  const duplicate=student?await database.collection('students').findOne({usn:student.usn,_id:{$ne:uid}},{session,collation:{locale:'en',strength:2}}):await database.collection('users').findOne({facultyId:profile.facultyId,_id:{$ne:uid}},{session,collation:{locale:'en',strength:2}});
  if(duplicate)fail('USN/employee ID conflicts with another institutional identity.');
  operationId=profile.exitOperationId||randomUUID();await database.collection('users').updateOne({_id:uid},{$set:{exitOperation:'reactivating',exitOperationId:operationId}},{session});
 });}finally{await session.endSession();}
 if(!isInactive(profile))return {uid,accountStatus:'active',status:'skipped',code:'ALREADY_ACTIVE',message:'Existing account is already active.'};
 let subjectsMapped=0;
 try{
  await auth.revokeRefreshTokens(uid);await auth.updateUser(uid,{disabled:false});
  const store=new DocumentStore(database,client);
  await store.runTransaction(async tx=>{
   const ref=tx.store.doc(`users/${uid}`),fresh=(await tx.get(ref)).data();
   if(!isInactive(fresh))return;
   if(fresh.exitOperationId!==operationId||fresh.exitOperation!=='reactivating')fail('Exit operation changed; review and retry.');
   const fields={accountStatus:'active',authDisabled:false,reactivatedAt:new Date(),reactivatedBy:actor.uid,exitOperation:null,exitOperationId:null};
   // Write before the normal mapper reads; all Mongo changes commit together.
   await ref.set(fields,{merge:true});
   if(profile.role==='student'){await tx.store.doc(`students/${uid}`).set(fields,{merge:true});subjectsMapped=await restoreStudent(tx.store,uid);const current=(await tx.store.doc(`students/${uid}`).get()).data();await tx.store.doc(`officeStudentSearch/${uid}`).set(officeSearchDocument(uid,current));}
   await database.collection('accountExitEvents').updateOne({_id:'reactivate:'+operationId},{$setOnInsert:{uid,action:'reactivate',actorId:actor.uid,at:fields.reactivatedAt}},{session:tx.store.session,upsert:true});
  });
 }catch(error){try{await auth.updateUser(uid,{disabled:true});await auth.revokeRefreshTokens(uid);}catch{/* Mongo remains blocked even when Auth is unavailable. */}fail('Reactivation is incomplete; the institutional account remains blocked. '+error.message,'failed-precondition');}
 return {uid,accountStatus:'active',subjectsMapped,message:'Existing account reactivated. Original UID, password and history preserved. Cancelled requests and archived notifications stay archived.'};
}

export async function accountRemoval({database,client,auth,actor,uid,confirmation,preview=false}) {
  const administrator=await database.collection('users').findOne({_id:actor.uid});
  if(!isManager(administrator?.role)||isInactive(administrator))fail('Administrator access required.','permission-denied');
  if(typeof uid!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(uid))fail('Select an existing account.');
  async function inspect(session) {
    const options={session},profile=await database.collection('users').findOne({_id:uid},options);
    await authorizeAccountTarget(database,actor,profile);if(!profile||!['student',...facultyRoles].includes(profile.role))fail('Only student and employee accounts can be removed.');
    const student=profile.role==='student'?await database.collection('students').findOne({_id:uid},options):null;
    const offerings=profile.role!=='student'?await database.collection('offerings').find({teacherId:uid,active:{$ne:false}},options).toArray():[];
    const enrollments=profile.role!=='student'?await database.collection('enrollments').countDocuments({teacherId:uid,active:true},options):0;
    const candidates=profile.role!=='student'?await database.collection('noDueRequests').find({status:{$in:pendingStatuses},$or:[{approverIds:uid},{mentorId:uid},{hodId:uid},{officeId:uid}]},options).toArray():[];
    const requests=candidates.filter(r=>r.hodId===uid&&r.hodApproval?.status!=='approved'||r.officeId===uid||r.mentorId===uid&&r.mentorApproval?.status!=='approved'||!r.approvalItems&&r.approverIds?.includes(uid)||Object.entries(r.approvalItems||{}).some(([key,item])=>item.approverId===uid&&r.approvalStates?.[key]!=='approved'));
    const mentees=isMentor(profile)?await database.collection('students').countDocuments({mentorId:uid,accountStatus:{$nin:['inactive','deleted','deactivating']}},options):0;
    const blockers=[];
    if(profile.exitOperation==='reactivating')blockers.push('Account reactivation is pending. Finish reactivation before deactivating again.');
    const departmentWorkflows=await database.collection('departmentWorkflows').find({$or:[{hodId:uid},{officeId:uid},{library:uid},{accounts:uid}]} ,options).toArray();if(departmentWorkflows.length)blockers.push('This employee is assigned in a department workflow. Replace that responsibility first.');
    const workflow=await database.collection('institutionPolicy').findOne({_id:'workflow'},options);
    if(profile.role!=='student'&&Object.values(workflow||{}).includes(uid))blockers.push('This employee is assigned in the current workflow configuration. Reassign that responsibility first.');
    if(offerings.length)blockers.push('This teacher is assigned to active offerings. Reassign those subjects before deactivation.');
    if(enrollments)blockers.push(`${enrollments} active enrollment mappings still reference this teacher. Reassign or deactivate those mappings first.`);
    if(requests.length)blockers.push(`${requests.length} current No-Due requests still reference this teacher. Resolve or reassign those approvals first.`);
    if(mentees)blockers.push(`${mentees} active mentees still reference this mentor. Reassign them first.`);
    return {profile,student,offerings,blockers};
  }
  if(preview){const details=await inspect();return exitIdentity(database,uid,details);}
  if(!['DELETE','DEACTIVATE'].includes(confirmation))fail('Type DEACTIVATE to confirm account deactivation.');
  const session=client.startSession();let completedRemoval=false;
  try {await session.withTransaction(async()=>{
    completedRemoval=false;
    const {profile,blockers}=await inspect(session),options={session};
    if(profile.exitOperation==='reactivating')fail('Account reactivation is pending; finish it before deactivation.');
    if(profile.accountStatus==='inactive'&&profile.authDisabled===true){completedRemoval=true;return;}
    if(blockers.length)fail(blockers.join(' '),'failed-precondition');
    const stamp=profile.accountStatus==='deactivating'&&profile.removedAt?profile.removedAt:new Date(),fields={accountStatus:'deactivating',removedAt:stamp,removedBy:actor.uid};
    await database.collection('users').updateOne({_id:uid},{$set:fields},options);
    await database.collection('accountExitEvents').updateOne({_id:`deactivate:${uid}:${stamp.getTime()}`},{$setOnInsert:{uid,action:'deactivate',actorId:actor.uid,at:stamp,identity:{name:profile.name,email:profile.email,role:profile.role,identifier:profile.facultyId||profile.usn}}},{...options,upsert:true});
    if(profile.role==='student') {
      await database.collection('students').updateOne({_id:uid},{$set:{...fields,offeringIds:[],teacherIds:[]}},options);
      await database.collection('enrollments').updateMany({studentId:uid,active:{$ne:false}},{$set:{active:false,accountStatus:'inactive',archivedAt:stamp,archivedBy:actor.uid}},options);
      await database.collection('clearancePlans').updateOne({_id:uid},{$set:{valid:false,accountStatus:'inactive'}},options);
      await database.collection('officeStudentSearch').deleteOne({_id:uid},options);
      const requests=await database.collection('noDueRequests').find({studentId:uid,status:{$in:pendingStatuses}},options).toArray();
      for(const r of requests){
        const states=Object.fromEntries(Object.entries(r.approvalStates||{}).map(([key,state])=>[key,state==='pending'?'cancelled':state]));
        await database.collection('noDueRequests').updateOne({_id:r._id},{$set:{status:'cancelled',previousStatus:r.status,approvalStates:states,cancelledAt:stamp,cancelledBy:actor.uid,cancellationReason:'Student account deactivated'}},options);
        await database.collection('approvals').updateMany({$or:[{requestId:r._id},{__parent:r._id}],status:'pending'},{$set:{status:'cancelled',previousStatus:'pending',cancelledAt:stamp,cancelledBy:actor.uid}},options);
      }
      await database.collection('notifications').updateMany({$or:[{studentId:uid},{__parent:uid}],read:{$ne:true}},{$set:{archived:true,archivedAt:stamp}},options);
    }
  });} finally {await session.endSession();}
  if(completedRemoval)return {uid,accountStatus:'inactive',authDisabled:true,status:'skipped',code:'ALREADY_INACTIVE',message:'Account is already inactive. Historical records preserved.'};
  // Mongo closes access first. If Firebase is temporarily unavailable, retries finish
  // this operation; the institutional account remains blocked in the meantime.
  try {await auth.updateUser(uid,{disabled:true});await auth.revokeRefreshTokens(uid);}
  catch(error){if(error.code!=='auth/user-not-found')fail('Account access is blocked. Firebase disable is pending; retry this removal to finish.','unavailable');}
  const finished=client.startSession();
  try{await finished.withTransaction(async()=>{await database.collection('users').updateOne({_id:uid},{$set:{accountStatus:'inactive',authDisabled:true}},{session:finished});await database.collection('students').updateOne({_id:uid},{$set:{accountStatus:'inactive'}},{session:finished});});}finally{await finished.endSession();}
  return {uid,accountStatus:'inactive',authDisabled:true,message:'Account deactivated. Historical records preserved. CSV import cannot reactivate it; use Reactivate existing account explicitly.'};
}
