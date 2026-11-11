import {createHash,randomUUID} from 'node:crypto';
import {sealAdministrativeBackup} from './administrative-backup.js';
import {departmentOf} from './department-master.js';
const fail=(m,c='invalid-argument')=>{throw Object.assign(Error(m),{code:c});};
export const resettableStatuses=['pending_stage1','pending_mentor','pending_hod','pending_office','cleared','rejected'];
const stage=r=>r.status==='rejected'?(Object.values(r.approvalStates||{}).includes('rejected')?'Stage 1':r.mentorApproval?.status==='rejected'?'Mentor':r.hodApproval?.status==='rejected'?'HOD':'Office'):({pending_stage1:'Stage 1',pending_mentor:'Mentor',pending_hod:'HOD',pending_office:'Office',cleared:'Office'})[r.status]||r.status;
export async function resetNoDueRequest({store,actor,id,input,backupKey}){
 if(actor.role!=='super_admin')fail('Only Super Admin may reset a No-Due request.','permission-denied');
 const reason=String(input.reason||'').trim();
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||reason.length<5||reason.length>2000||input.confirmation!==true||!Number.isSafeInteger(input.version)||!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestKey||''))fail('Confirm the reset and provide a reason, current version and operation key.');
 const operation=createHash('sha256').update(actor.uid+':'+id+':'+input.requestKey).digest('hex');
 let duplicate=false;
 await store.runTransaction(async tx=>{
  const db=tx.store.database,options={session:tx.store.session},raw=await db.collection('noDueRequests').findOne({_id:id},options);
  if(!raw)fail('Request not found.');
  if(actor.managementDepartmentId&&await departmentOf(db,'noDueRequests',raw)!==actor.managementDepartmentId)fail('Request belongs to another department.','permission-denied');
  if(raw.status==='reset'){if(raw.resetOperation===operation){duplicate=true;return;}fail('This request has already been reset.','already-exists');}
  if(!resettableStatuses.includes(raw.status))fail('Only an active, unissued request may be reset.');
  if((raw.version||0)!==input.version)fail('Request changed. Reload before resetting.','already-exists');
  const latest=await db.collection('noDueRequests').findOne({studentId:raw.studentId},{...options,sort:{createdAt:-1,_id:-1}});if(latest?._id!==id)fail('A newer request exists. Historical requests cannot be reset.');
  const studentRef=tx.store.doc('students/'+raw.studentId),student=(await tx.get(studentRef)).data();if(!student)fail('Student profile is unavailable.');
  const approvals=await db.collection('approvals').find({$or:[{requestId:id},{__parent:id}]},options).toArray();
  const backup=sealAdministrativeBackup({noDueRequests:[raw],approvals},backupKey);
  await db.collection('administrativeBackups').insertOne({...backup,operation,kind:'REQUEST_RESET',requestId:id},options);
  const at=new Date(),patch={status:'reset',resetBy:actor.uid,resetAt:at,resetReason:reason,previousStatus:raw.status,previousStage:stage(raw),resetOperation:operation,resetBackupId:backup._id,version:(raw.version||0)+1};
  tx.update(studentRef,{requestRevision:(student.requestRevision||0)+1});
  const changed=await db.collection('noDueRequests').updateOne({_id:id,...(raw.version===undefined?{version:{$exists:false}}:{version:raw.version})},{$set:patch},options);
  if(changed.matchedCount!==1)fail('Request changed. Reload before resetting.','already-exists');
  await db.collection('superAdminAudit').insertOne({_id:randomUUID(),action:'NO_DUE_REQUEST_RESET',actorId:actor.uid,studentId:raw.studentId,requestId:id,reason,previousStatus:raw.status,previousStage:patch.previousStage,backupId:backup._id,timestamp:at},options);
  tx.create(tx.store.doc('users/'+raw.studentId+'/notifications/'+operation),{type:'request_reset',requestId:id,studentId:raw.studentId,status:'reset',actorName:actor.name||'Super Admin',reason,message:'Your No-Due request was reset. You can make a new request.',createdAt:at,read:false});
 });return {saved:true,duplicate,status:'reset'};
}
