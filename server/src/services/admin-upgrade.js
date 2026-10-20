import {isMentor} from '../../../js/capabilities.js';
import {retireHodAuthority} from './account-authority.js';
import {eligibleConfigurationAccount} from './configuration-accounts.js';
import {assertUniqueDepartment,departmentNameKey} from './department-uniqueness.js';
import {createHash,randomUUID} from 'node:crypto';
import {createProvisioner} from './provisioning.js';
import {DocumentStore} from './document-store.js';
import {accountExit,accountRemoval,isInactive} from './account-removal.js';
import {authorizeAccountTarget,departmentOf} from './department-master.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
const fail=(message,code='invalid-argument')=>{throw Object.assign(new Error(message),{code});};
const manager=async(db,actor,superOnly=false)=>{const u=await db.collection('users').findOne({_id:actor.uid});if(!u||isInactive(u)||!(superOnly?u.role==='super_admin':['admin','super_admin'].includes(u.role)))fail('Administrator permission required.','permission-denied');return {...u,uid:u._id,managementDepartmentId:actor.managementDepartmentId};};
export async function auditAdmin(db,session,actor,action,departmentId,targets,summary,extra={}){
 await db.collection('superAdminAudit').insertOne({_id:randomUUID(),actorUid:actor.uid,actorId:actor.uid,actorRole:actor.role,departmentId:departmentId||null,action,targets,timestamp:new Date(),summary,...extra},{session});
}
export async function createDepartmentMaster({database,client,actor,input}){
 actor=await manager(database,actor,true);
 const code=String(input.code||'').trim().toUpperCase(),name=String(input.name||'').trim(),requestId=input.requestId;
 if(!/^[A-Z0-9_-]{1,30}$/.test(code)||!name||name.length>150||!['active','inactive'].includes(input.status))fail('Valid department name, code and status are required.');
 if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestId||''))fail('A stable department request ID is required.');
 const id='dept_'+hash(actor.uid+':'+requestId).slice(0,32);await assertUniqueDepartment(database,{code,name,id});
 if(input.initialAdmin)fail('Create the department first, then explicitly assign its Admin in Department Setup.');
 if(input.schemeIds!==undefined&&!Array.isArray(input.schemeIds)||input.sections!==undefined&&!Array.isArray(input.sections))fail('Schemes and sections must be selected lists.');
 const schemeIds=[...new Set(input.schemeIds||[])],sections=[...new Set((input.sections||[]).map(v=>String(v).trim().toUpperCase()))];
 if(sections.some(v=>! /^[A-Z0-9-]{1,10}$/.test(v)))fail('Choose applicable schemes and sections.');
 for(const sid of schemeIds)if(!await database.collection('schemes').findOne({_id:sid,status:'active'}))fail('Choose active schemes.');
 const digest=hash(JSON.stringify({code,name,status:input.status,schemeIds,sections})),session=client.startSession();
 try{await session.withTransaction(async()=>{
  const previous=await database.collection('departments').findOne({_id:id},{session});if(previous){if(previous.creationDigest!==digest)fail('Department request ID belongs to different details.','already-exists');return;}
  await assertUniqueDepartment(database,{code,name,id,session});
  await database.collection('departments').insertOne({_id:id,code,name,codeKey:code.toLowerCase(),nameKey:departmentNameKey(name),status:input.status,setupStatus:'incomplete',schemeIds,sections,creationDigest:digest,createdAt:new Date(),updatedAt:new Date()},{session});
  await auditAdmin(database,session,actor,'DEPARTMENT_CREATED',id,[id],'Empty department master created. Leadership and academic setup require explicit actions.');
 });}finally{await session.endSession();}
 return database.collection('departments').findOne({_id:id});
}
export async function replaceLeadership({database,client,auth,actor,input,provisioner}){
 actor=await manager(database,actor,true);const {departmentId,position}=input;if(!['admin','hod'].includes(position))fail('Choose Admin or HOD.');
 const dep=await database.collection('departments').findOne({_id:departmentId});if(!dep||dep.status==='provisioning')fail('Choose an existing department.');
 if(actor.managementDepartmentId&&actor.managementDepartmentId!==dep._id)fail('Wrong department context.','permission-denied');
 let uid=input.uid;if(input.newAccount){const row={...input.newAccount,role:position,scope:'department',department:dep.code};const result=await provisioner.dispatch(actor.uid,{action:'provision',row,requestId:input.requestId});uid=result.uid;}
 const candidate=uid&&await database.collection('users').findOne({_id:uid}),identity=await auth.getUser(uid||'invalid');
 if(identity.disabled||identity.email?.toLowerCase()!==candidate?.email?.toLowerCase())fail('Leadership Firebase identity is disabled or does not match the institutional account.');
 if(!eligibleConfigurationAccount(candidate)||!['admin','hod','subject_faculty','mentor'].includes(candidate.role)||(await departmentOf(database,'users',{...candidate,scope:'department'}))!==dep._id)fail('Choose an eligible active staff account in the same department.');
 if(['admin','hod'].includes(candidate.role)&&candidate.role!==position)fail('An active leadership account cannot be converted into another leadership role.');
 if(position==='admin'&&candidate.role!==position){if(await database.collection('offerings').countDocuments({teacherId:uid,active:{$ne:false}})||await database.collection('students').countDocuments({mentorId:uid,accountStatus:{$nin:['inactive','deleted','deactivating','deleting','exited','exiting']}}))fail('Reassign active teaching/mentoring responsibilities before promoting this staff member.');}
 const session=client.startSession();let previous;try{await session.withTransaction(async()=>{
  const fresh=await database.collection('departments').findOne({_id:dep._id},{session}),field=position==='admin'?'adminId':'hodId';previous=fresh[field]|| (position==='hod'?(await database.collection('departmentWorkflows').findOne({_id:dep._id},{session}))?.hodId:null);
  if(previous===uid)return;
  await database.collection('users').updateOne({_id:uid},{$set:{...(position==='hod'&&candidate.role!=='hod'?{leadershipPreviousRole:candidate.role}:{}),role:position,scope:'department',departmentId:dep._id,department:dep.code}},{session});
  await database.collection('departments').updateOne({_id:dep._id},{$set:{[field]:uid,...(position==='admin'?{departmentAdminId:uid}:{}),updatedAt:new Date()}},{session});
  if(position==='hod'){if(previous)await retireHodAuthority(database,session,previous,dep._id,uid);await database.collection('departmentWorkflows').updateOne({_id:dep._id},{$set:{departmentId:dep._id,hodId:uid}},{upsert:true,session});if(dep.code==='ISE')await database.collection('institutionPolicy').updateOne({_id:'workflow'},{$set:{hodId:uid}},{session});}
  const change={_id:randomUUID(),departmentId:dep._id,position,oldId:previous||null,newId:uid,changedBy:actor.uid,timestamp:new Date()};await database.collection('departmentLeadershipHistory').insertOne(change,{session});
  await auditAdmin(database,session,actor,position==='admin'?'DEPARTMENT_ADMIN_REPLACED':previous?'HOD_REPLACED':'HOD_ASSIGNED',dep._id,[previous,uid].filter(Boolean),'Leadership changed; historical approvals remain attributed to their original actors.',{oldId:previous||null,newId:uid});
 });}finally{await session.endSession();}return {saved:true,oldId:previous||null,newId:uid};
}
async function leadershipBlockers(db,target){
 const current=await db.collection('departments').find({status:'active',$or:[{adminId:target._id},{departmentAdminId:target._id},{hodId:target._id}]}).toArray();if(current.length)fail('Assign a replacement before deactivating current department leadership.','failed-precondition');
}
async function checkCurrentResponsibilities(db,target,session){
 if(target.role==='student'||target.role==='admin')return;
 const options={session};
 if(await db.collection('offerings').countDocuments({teacherId:target._id,active:{$ne:false}},options)||await db.collection('enrollments').countDocuments({teacherId:target._id,active:true},options))fail('Reassign active classes before deactivation.');
 if(isMentor(target)&&await db.collection('students').countDocuments({mentorId:target._id,accountStatus:{$nin:['inactive','deleted','deactivating','deleting','exited','exiting']}},options))fail('Reassign active mentees before deactivation.');
 if(await db.collection('departmentWorkflows').countDocuments({$or:[{hodId:target._id},{officeId:target._id},{library:target._id},{accounts:target._id}]},options))fail('Replace current workflow responsibilities before deactivation.');
 const requests=await db.collection('noDueRequests').find({status:{$in:['pending_stage1','pending_mentor','pending_hod','pending_office','rejected','cleared']},$or:[{approverIds:target._id},{mentorId:target._id},{hodId:target._id},{officeId:target._id}]},options).toArray();
 if(requests.some(r=>r.hodId===target._id&&r.hodApproval?.status!=='approved'||r.mentorId===target._id&&r.mentorApproval?.status!=='approved'||r.officeId===target._id||Object.entries(r.approvalItems||{}).some(([key,item])=>item.approverId===target._id&&r.approvalStates?.[key]!=='approved')))fail('Resolve pending approvals before deactivation.');
}
export async function bulkAccountStatus({database,client,auth,demo,actor,input}){
 actor=await manager(database,actor);const {accountIds,targetStatus,requestId,confirmation}=input;
 if(!Array.isArray(accountIds)||!accountIds.length||accountIds.length>100||accountIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))||new Set(accountIds).size!==accountIds.length)fail('Select 1Ã¢â‚¬“100 unique existing accounts.');
 if(!['inactive','active','exited'].includes(targetStatus)||confirmation!==(targetStatus==='inactive'?'DEACTIVATE':targetStatus==='exited'?'EXIT':'REACTIVATE'))fail('Explicit confirmation is required.');
 if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestId||''))fail('A stable bulk operation ID is required.');
 const key=hash(actor.uid+':'+requestId),digest=hash(JSON.stringify({accountIds,targetStatus})),old=await database.collection('bulkAccountJobs').findOne({_id:key});if(old&&old.digest!==digest)fail('Bulk request ID belongs to another selection.','already-exists');
 // All target IDs are authorized before any mutation. Forged cross-department IDs
 // reject the whole batch; dependency blockers receive explicit per-row outcomes.
 const targets=await database.collection('users').find({_id:{$in:accountIds}}).toArray();if(targets.length!==accountIds.length)fail('An account no longer exists.');
 for(const target of targets)await authorizeAccountTarget(database,actor,target);
 if(old?.state==='complete')return old.result;
 await database.collection('bulkAccountJobs').updateOne({_id:key},{$setOnInsert:{actorUid:actor.uid,digest,accountIds,targetStatus,createdAt:new Date(),state:'running'}},{upsert:true});
 const results=[];
 for(const uid of accountIds){try{
  const previous=old?.result?.results.find(r=>r.uid===uid&&r.status==='success');if(previous){results.push(previous);continue;}
  const target=await database.collection('users').findOne({_id:uid});await authorizeAccountTarget(database,actor,target);
  if(!['student','subject_faculty','mentor','hod','admin'].includes(target.role))fail('This shared service role is not eligible for bulk account changes.');
  // Check before dependency inspection and again under the transaction lock.
  // A new request ID must never turn a no-op into a successful state change.
  const assertTransition=fresh=>{if(['exited','exiting'].includes(fresh.accountStatus))fail('This identity has left the institution. Explicit restoration is required.','ACCOUNT_EXITED');if(fresh.accountStatus==='deactivating'){if(fresh.bulkStatusOperation!==key)fail('Another account change is in progress.','CHANGE_IN_PROGRESS');return;}if(targetStatus==='inactive'&&isInactive(fresh))fail('Account is already inactive.','ALREADY_INACTIVE');if(targetStatus==='active'&&!isInactive(fresh))fail('Account is already active.','ALREADY_ACTIVE');};
  if(targetStatus!=='exited')assertTransition(target);
  if(targetStatus==='exited'){
   await leadershipBlockers(database,target);await accountExit({database,client,auth,actor,input:{action:'institutional-exit',kind:target.role==='student'?'student':'faculty',uid,confirmation:'EXIT',reason:input.reason,exitType:input.exitType}});
  }else if(targetStatus==='inactive'){
   await leadershipBlockers(database,target);
   if(target.role!=='admin'){const preview=await accountRemoval({database,client,auth,actor,uid,preview:true});if(preview.blockers.length)fail(preview.blockers.join(' '),'failed-precondition');}
   const session=client.startSession();try{await session.withTransaction(async()=>{const fresh=await database.collection('users').findOne({_id:uid},{session});assertTransition(fresh);await leadershipBlockers(database,fresh);await checkCurrentResponsibilities(database,fresh,session);await database.collection('users').updateOne({_id:uid},{$set:{accountStatus:'deactivating',bulkStatusOperation:key,bulkStatusOnly:true,removedBy:actor.uid,removedAt:fresh.accountStatus==='deactivating'?fresh.removedAt:new Date()}},{session});if(target.role==='student')await database.collection('students').updateOne({_id:uid},{$set:{accountStatus:'deactivating'}},{session});});}finally{await session.endSession();}
   await auth.updateUser(uid,{disabled:true});await auth.revokeRefreshTokens(uid);
   await database.collection('users').updateOne({_id:uid},{$set:{accountStatus:'inactive',authDisabled:true}});if(target.role==='student')await database.collection('students').updateOne({_id:uid},{$set:{accountStatus:'inactive'}});
  }else if(target.bulkStatusOnly){
   const claim=client.startSession();try{await claim.withTransaction(async()=>{const fresh=await database.collection('users').findOne({_id:uid},{session:claim});assertTransition(fresh);await database.collection('users').updateOne({_id:uid},{$set:{accountStatus:'deactivating',bulkStatusOperation:key}},{session:claim});});}finally{await claim.endSession();}
   const identity=await auth.getUser(uid);if(identity.email?.toLowerCase()!==target.email.toLowerCase())fail('Firebase identity no longer matches.');await auth.revokeRefreshTokens(uid);await auth.updateUser(uid,{disabled:false});
   const session=client.startSession();try{await session.withTransaction(async()=>{await database.collection('users').updateOne({_id:uid},{$set:{accountStatus:'active',authDisabled:false,reactivatedBy:actor.uid,reactivatedAt:new Date()}},{session});if(target.role==='student')await database.collection('students').updateOne({_id:uid},{$set:{accountStatus:'active'}},{session});});}catch(e){await auth.updateUser(uid,{disabled:true});throw e;}finally{await session.endSession();}
  }else if(isInactive(target)){const restored=await accountExit({database,client,auth,actor,input:{action:'reactivate',kind:target.role==='student'?'student':'faculty',uid,confirmation:'REACTIVATE'},restoreStudent:(repository,id)=>createProvisioner({db:repository,auth,demo}).restoreStudentMappings(id)});if(restored.status==='skipped')fail(restored.message,restored.code);}
  results.push({uid,status:'success',accountStatus:targetStatus});
 }catch(e){results.push({uid,status:'skipped',code:e.code||'failed-precondition',reason:e.message});}}
 const pending=await database.collection('users').countDocuments({_id:{$in:accountIds},accountStatus:{$in:['deactivating','exiting']},...(targetStatus==='exited'?{}:{bulkStatusOperation:key})});
 const result={retryRequired:pending>0,results,succeeded:results.filter(r=>r.status==='success').length,skipped:results.filter(r=>r.status!=='success').length};
 const session=client.startSession();try{await session.withTransaction(async()=>{const fresh=await database.collection('bulkAccountJobs').findOne({_id:key},{session});if(fresh.state==='complete')return;await database.collection('bulkAccountJobs').updateOne({_id:key},{$set:{state:pending?'retry_required':'complete',result,completedAt:new Date()}},{session});const changed=results.filter(r=>r.status==='success'&&!fresh.result?.results.some(p=>p.uid===r.uid&&p.status==='success'));if(changed.length)await auditAdmin(database,session,actor,targetStatus==='inactive'?'ACCOUNT_DEACTIVATED':targetStatus==='exited'?'ACCOUNT_INSTITUTIONAL_EXIT':'ACCOUNT_REACTIVATED',actor.managementDepartmentId,changed.map(r=>r.uid),`${changed.length} successful; ${result.skipped} skipped.`,{operationId:key,reason:String(input.reason||'Explicit administrator lifecycle operation'),operationType:targetStatus});});}finally{await session.endSession();}
 return result;
}
export function adminUpgradeRoutes(app,options){
 app.post('/api/admin/accounts/bulk-status',async(req,res)=>res.json(await bulkAccountStatus({...options,actor:req.actor,input:req.body})));
 app.post('/api/administration/leadership',async(req,res)=>res.json(await replaceLeadership({...options,actor:req.actor,input:req.body})));
 app.get('/api/administration/audit',async(req,res)=>{const actor=await manager(options.database,req.actor,true),query={};if(actor.managementDepartmentId)query.departmentId=actor.managementDepartmentId;else if(req.query.departmentId)query.departmentId=String(req.query.departmentId);if(req.query.action)query.action=String(req.query.action);if(req.query.actor)query.actorUid=String(req.query.actor);if(req.query.date){const date=new Date(req.query.date);if(!Number.isFinite(+date))fail('Invalid audit date.');query.timestamp={$gte:date,$lt:new Date(+date+86400000)};}const rows=await options.database.collection('superAdminAudit').find(query).sort({timestamp:-1}).limit(200).toArray(),ids=[...new Set(rows.flatMap(r=>[r.actorId||r.actorUid,r.studentId||r.target]).filter(v=>typeof v==='string'))],people=await options.database.collection('users').find({_id:{$in:ids}},{projection:{name:1,usn:1,facultyId:1}}).toArray(),byId=new Map(people.map(u=>[u._id,u])),deps=await options.database.collection('departments').find({},{projection:{name:1}}).toArray(),byDep=new Map(deps.map(d=>[d._id,d.name]));res.json({rows:rows.map(r=>{const target=byId.get(r.studentId||r.target);return {...r,actorName:r.actorName||byId.get(r.actorId||r.actorUid)?.name||'Former administrator',targetName:target?target.name+(target.usn?' — '+target.usn:target.facultyId?' — '+target.facultyId:''):byDep.get(r.target)||'Institution configuration',departmentName:byDep.get(r.departmentId)||'Institution',summary:r.summary||((target?.name||byDep.get(r.target)||'Institution configuration')+' · '+String(r.action||'').replaceAll('_',' '))};})});});
}
