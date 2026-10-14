import {assertUniqueDepartment,departmentNameKey} from './department-uniqueness.js';
import {createHash,randomUUID} from 'node:crypto';
import {createProvisioner} from './provisioning.js';
import {DocumentStore} from './document-store.js';
import {accountExit,accountRemoval,isInactive} from './account-removal.js';
import {authorizeAccountTarget,departmentOf,migrateDepartmentMaster} from './department-master.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
const fail=(message,code='invalid-argument')=>{throw Object.assign(new Error(message),{code});};
const manager=async(db,actor,superOnly=false)=>{const u=await db.collection('users').findOne({_id:actor.uid});if(!u||isInactive(u)||!(superOnly?u.role==='super_admin':['admin','super_admin'].includes(u.role)))fail('Administrator permission required.','permission-denied');return {...u,uid:u._id,managementDepartmentId:actor.managementDepartmentId};};
export async function auditAdmin(db,session,actor,action,departmentId,targets,summary,extra={}){
 await db.collection('superAdminAudit').insertOne({_id:randomUUID(),actorUid:actor.uid,actorId:actor.uid,actorRole:actor.role,departmentId:departmentId||null,action,targets,timestamp:new Date(),summary,...extra},{session});
}
export async function createDepartmentWithAdmin({database,client,auth,demo,actor,input,provisionerFactory}){
 actor=await manager(database,actor,true);
 const code=String(input.code||'').trim().toUpperCase(),name=String(input.name||'').trim(),requestId=input.requestId;
 if(!/^[A-Z0-9_-]{1,30}$/.test(code)||!name||name.length>150||!['active','inactive'].includes(input.status))fail('Valid department name, code and status are required.');
 if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestId||''))fail('A stable department request ID is required.');
 const jobId=hash(actor.uid+':'+requestId),id='dept_'+jobId.slice(0,32),job=await database.collection('departmentProvisioningJobs').findOne({_id:jobId});
 await assertUniqueDepartment(database,{code,name,id});
 const admin=input.initialAdmin||{},email=String(admin.email||'').trim().toLowerCase(),employeeId=String(admin.employeeId||'').trim().toUpperCase();
 if(!String(admin.name||'').trim()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[A-Z0-9_-]{1,80}$/.test(employeeId))fail('Initial Admin name, college email and employee ID are required.');
 const schemeIds=[...new Set(input.schemeIds||[])],sections=[...new Set((input.sections||[]).map(v=>String(v).trim().toUpperCase()))];
 if(!schemeIds.length||!sections.length||sections.some(v=>! /^[A-Z0-9-]{1,10}$/.test(v)))fail('Choose applicable schemes and sections.');
 for(const sid of schemeIds)if(!await database.collection('schemes').findOne({_id:sid,status:'active'}))fail('Choose active schemes.');
 const digest=hash(JSON.stringify({code,name,status:input.status,email,employeeId,adminName:admin.name,phone:admin.phone||'',schemeIds,sections}));
 if(job&&job.digest!==digest)fail('This retry belongs to a different department request.','already-exists');
 if(job?.state==='complete')return database.collection('departments').findOne({_id:id});
 const policy=await database.collection('institutionPolicy').findOne({_id:'institution'})||{},domain=email.split('@')[1];
 if(!(domain==='demo.test'&&(demo||policy.demoStaffProvisioningEnabled))&&!(policy.allowedDomains||[]).includes(domain))fail('Admin email domain is not allowed.');
 const ownedRequest='department-admin-'+jobId.slice(0,40),expectedUid='p_'+hash(actor.uid+':'+ownedRequest).slice(0,48);
 const existing=await database.collection('users').findOne({$or:[{email},{facultyId:employeeId}]});if(existing&&existing._id!==expectedUid)fail('Initial Admin identity already belongs to an existing account.','already-exists');
 try{const existingAuth=await auth.getUserByEmail(email);if(existingAuth.uid!==expectedUid)fail('Admin email already belongs to another Firebase identity.','already-exists');}catch(e){if(e.code!=='auth/user-not-found')throw e;}
 const session=client.startSession();try{await session.withTransaction(async()=>{
  await assertUniqueDepartment(database,{code,name,id,session});const previous=await database.collection('departmentProvisioningJobs').findOne({_id:jobId},{session});if(previous&&previous.digest!==digest)fail('Department operation conflict.');
  await database.collection('departmentProvisioningJobs').updateOne({_id:jobId},{$setOnInsert:{actorUid:actor.uid,digest,departmentId:id,expectedAdminUid:expectedUid,state:'reserved',createdAt:new Date(),retryInput:{code,name,status:input.status,requestId,schemeIds,sections,initialAdmin:{name:admin.name,email,employeeId,phone:String(admin.phone||'')}}}},{upsert:true,session});
  await database.collection('departments').updateOne({_id:id},{$setOnInsert:{code,name,codeKey:code.toLowerCase(),nameKey:departmentNameKey(name),status:'provisioning',createdAt:new Date(),updatedAt:new Date(),schemeIds,sections}},{upsert:true,session});
 });}finally{await session.endSession();}
 try{
  const provisioner=provisionerFactory?provisionerFactory({departmentBootstrap:{id,code}}):createProvisioner({db:new DocumentStore(database,client),auth,demo,departmentBootstrap:{id,code}});
  const account=await provisioner.dispatch(actor.uid,{action:'provision',row:{role:'admin',scope:'department',department:code,name:String(admin.name).trim(),collegeEmail:email,facultyId:employeeId,phone:String(admin.phone||'')},requestId:ownedRequest});
  const [firebase,user]=await Promise.all([auth.getUser(account.uid),database.collection('users').findOne({_id:account.uid})]);
  if(firebase.uid!==expectedUid||firebase.email!==email||firebase.disabled||user?.role!=='admin'||user.departmentId!==id)fail('Provisioned Admin identity failed verification.');
  const final=client.startSession();try{await final.withTransaction(async()=>{
   const state=await database.collection('departmentProvisioningJobs').findOne({_id:jobId},{session:final});if(state.state==='complete')return;
   await database.collection('departments').updateOne({_id:id},{$set:{status:input.status,adminId:account.uid,departmentAdminId:account.uid,updatedAt:new Date()}},{session:final});
   for(const sid of schemeIds)await database.collection('schemes').updateOne({_id:sid,scope:'department'},{$addToSet:{departmentIds:id}},{session:final});
   await database.collection('departmentProvisioningJobs').updateOne({_id:jobId},{$set:{state:'complete',adminUid:account.uid,completedAt:new Date()}},{session:final});
   await auditAdmin(database,final,actor,'DEPARTMENT_CREATED',id,[id],'Department and initial administrator created.');
   await auditAdmin(database,final,actor,'DEPARTMENT_ADMIN_CREATED',id,[account.uid],'Initial department administrator provisioned.');
  });}finally{await final.endSession();}
  // Attach only unambiguous legacy references; never touch identity or history fields.
  const plan=await migrateDepartmentMaster(database,client);for(const c of plan.changes.filter(c=>c.fields.departmentId===id))await database.collection(c.collection).updateOne({_id:c.id,departmentId:{$exists:false}},{$set:c.fields});
  return database.collection('departments').findOne({_id:id});
 }catch(e){await database.collection('departmentProvisioningJobs').updateOne({_id:jobId,state:{$ne:'complete'}},{$set:{state:'retry_required',updatedAt:new Date(),errorCode:String(e.code||'provisioning-failed')}});fail('Department setup is incomplete and remains unavailable. Retry the same validated request to resume safely. '+e.message,e.code||'failed-precondition');}
}
export async function replaceLeadership({database,client,auth,actor,input,provisioner}){
 actor=await manager(database,actor,true);const {departmentId,position}=input;if(!['admin','hod'].includes(position))fail('Choose Admin or HOD.');
 const dep=await database.collection('departments').findOne({_id:departmentId});if(!dep||dep.status==='provisioning')fail('Choose an existing department.');
 if(actor.managementDepartmentId&&actor.managementDepartmentId!==dep._id)fail('Wrong department context.','permission-denied');
 let uid=input.uid;if(input.newAccount){const row={...input.newAccount,role:position,scope:'department',department:dep.code};const result=await provisioner.dispatch(actor.uid,{action:'provision',row,requestId:input.requestId});uid=result.uid;}
 const candidate=uid&&await database.collection('users').findOne({_id:uid}),identity=await auth.getUser(uid||'invalid');
 if(identity.disabled||identity.email?.toLowerCase()!==candidate?.email?.toLowerCase())fail('Leadership Firebase identity is disabled or does not match the institutional account.');
 if(!candidate||isInactive(candidate)||!['admin','hod','subject_faculty','mentor'].includes(candidate.role)||(await departmentOf(database,'users',{...candidate,scope:'department'}))!==dep._id)fail('Choose an eligible active staff account in the same department.');
 if(['admin','hod'].includes(candidate.role)&&candidate.role!==position)fail('An active leadership account cannot be converted into another leadership role.');
 if(candidate.role!==position){if(await database.collection('offerings').countDocuments({teacherId:uid,active:{$ne:false}})||await database.collection('students').countDocuments({mentorId:uid,accountStatus:{$nin:['inactive','deleted','deactivating']}}))fail('Reassign active teaching/mentoring responsibilities before promoting this staff member.');}
 const session=client.startSession();let previous;try{await session.withTransaction(async()=>{
  const fresh=await database.collection('departments').findOne({_id:dep._id},{session}),field=position==='admin'?'adminId':'hodId';previous=fresh[field]|| (position==='hod'?(await database.collection('departmentWorkflows').findOne({_id:dep._id},{session}))?.hodId:null);
  if(previous===uid)return;
  await database.collection('users').updateOne({_id:uid},{$set:{role:position,scope:'department',departmentId:dep._id,department:dep.code}},{session});
  await database.collection('departments').updateOne({_id:dep._id},{$set:{[field]:uid,...(position==='admin'?{departmentAdminId:uid}:{}),updatedAt:new Date()}},{session});
  if(position==='hod'){await database.collection('departmentWorkflows').updateOne({_id:dep._id},{$set:{departmentId:dep._id,hodId:uid}},{upsert:true,session});if(dep.code==='ISE')await database.collection('institutionPolicy').updateOne({_id:'workflow'},{$set:{hodId:uid}},{session});}
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
 if(target.role==='mentor'&&await db.collection('students').countDocuments({mentorId:target._id,accountStatus:{$nin:['inactive','deleted','deactivating']}},options))fail('Reassign active mentees before deactivation.');
 if(await db.collection('departmentWorkflows').countDocuments({$or:[{hodId:target._id},{officeId:target._id},{library:target._id},{accounts:target._id}]},options))fail('Replace current workflow responsibilities before deactivation.');
 const requests=await db.collection('noDueRequests').find({status:{$in:['pending_stage1','pending_mentor','pending_hod','pending_office','rejected','cleared']},$or:[{approverIds:target._id},{mentorId:target._id},{hodId:target._id},{officeId:target._id}]},options).toArray();
 if(requests.some(r=>r.hodId===target._id&&r.hodApproval?.status!=='approved'||r.mentorId===target._id&&r.mentorApproval?.status!=='approved'||r.officeId===target._id||Object.entries(r.approvalItems||{}).some(([key,item])=>item.approverId===target._id&&r.approvalStates?.[key]!=='approved')))fail('Resolve pending approvals before deactivation.');
}
export async function bulkAccountStatus({database,client,auth,demo,actor,input}){
 actor=await manager(database,actor);const {accountIds,targetStatus,requestId,confirmation}=input;
 if(!Array.isArray(accountIds)||!accountIds.length||accountIds.length>100||accountIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))||new Set(accountIds).size!==accountIds.length)fail('Select 1–100 unique existing accounts.');
 if(!['inactive','active'].includes(targetStatus)||confirmation!==(targetStatus==='inactive'?'DEACTIVATE':'REACTIVATE'))fail('Explicit confirmation is required.');
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
  const assertTransition=fresh=>{if(fresh.accountStatus==='deactivating'){if(fresh.bulkStatusOperation!==key)fail('Another account change is in progress.','CHANGE_IN_PROGRESS');return;}if(targetStatus==='inactive'&&isInactive(fresh))fail('Account is already inactive.','ALREADY_INACTIVE');if(targetStatus==='active'&&!isInactive(fresh))fail('Account is already active.','ALREADY_ACTIVE');};
  assertTransition(target);
  if(targetStatus==='inactive'){
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
 const pending=await database.collection('users').countDocuments({_id:{$in:accountIds},accountStatus:'deactivating',bulkStatusOperation:key});
 const result={retryRequired:pending>0,results,succeeded:results.filter(r=>r.status==='success').length,skipped:results.filter(r=>r.status!=='success').length};
 const session=client.startSession();try{await session.withTransaction(async()=>{const fresh=await database.collection('bulkAccountJobs').findOne({_id:key},{session});if(fresh.state==='complete')return;await database.collection('bulkAccountJobs').updateOne({_id:key},{$set:{state:pending?'retry_required':'complete',result,completedAt:new Date()}},{session});const changed=results.filter(r=>r.status==='success'&&!fresh.result?.results.some(p=>p.uid===r.uid&&p.status==='success'));if(changed.length)await auditAdmin(database,session,actor,targetStatus==='inactive'?'ACCOUNT_BULK_DEACTIVATED':'ACCOUNT_BULK_REACTIVATED',actor.managementDepartmentId,changed.map(r=>r.uid),`${changed.length} successful; ${result.skipped} skipped.`,{operationId:key});});}finally{await session.endSession();}
 return result;
}
export function adminUpgradeRoutes(app,options){
 app.post('/api/admin/accounts/bulk-status',async(req,res)=>res.json(await bulkAccountStatus({...options,actor:req.actor,input:req.body})));
 app.post('/api/administration/leadership',async(req,res)=>res.json(await replaceLeadership({...options,actor:req.actor,input:req.body})));
 app.get('/api/administration/audit',async(req,res)=>{const actor=await manager(options.database,req.actor,true),query={};if(actor.managementDepartmentId)query.departmentId=actor.managementDepartmentId;else if(req.query.departmentId)query.departmentId=String(req.query.departmentId);if(req.query.action)query.action=String(req.query.action);if(req.query.actor)query.actorUid=String(req.query.actor);if(req.query.date){const date=new Date(req.query.date);if(!Number.isFinite(+date))fail('Invalid audit date.');query.timestamp={$gte:date,$lt:new Date(+date+86400000)};}res.json({rows:await options.database.collection('superAdminAudit').find(query).sort({timestamp:-1}).limit(200).toArray()});});
}
