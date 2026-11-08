import {createHash} from 'node:crypto';
import {authorizeAccountTarget} from './department-master.js';
const fail=(message,code='invalid-argument')=>{throw Object.assign(new Error(message),{code});};
const contains=(value,uid)=>typeof value==='string'?value===uid:Array.isArray(value)?value.some(v=>contains(v,uid)):value&&typeof value==='object'&&!(value instanceof Date)?Object.values(value).some(v=>contains(v,uid)):false;
const setup=new Set(['users','students','uniqueIdentities','provisioningJobs','enrollments','clearancePlans','officeStudentSearch','bulkImportJobs','permanentDeleteJobs']);
async function classify(database,actor,uid,session,operationId,snapshot){
 const user=await database.collection('users').findOne({_id:uid},{session});if(!user)return{uid,classification:'MISSING',reason:'Already removed.'};const result={uid,name:user.name,email:user.email,role:user.role};
 const block=(classification,reason,category=classification)=>({...result,classification,category,reason});if(user.accountStatus==='deleting'&&user.permanentDeleteOperation!==operationId)return block('HAS_HISTORY','A permanent removal is pending. Retry the original operation.');
 if(user.role==='super_admin'&&await database.collection('users').countDocuments({role:'super_admin',accountStatus:{$nin:['inactive','deleted','deleting']}},{session})<=1)return block('LAST_SUPER_ADMIN_PROTECTED','The last active Super Admin is protected.');
 if(uid===actor.uid)return block('SELF_PROTECTED','You cannot permanently delete your own account.');
 if(['office','library','accounts','physics_lab','chemistry_lab','sports'].includes(user.role))return block('SHARED_SERVICE_PROTECTED','Institution service accounts are protected.');
 if(['admin','super_admin'].includes(user.role)||await database.collection('departments').findOne({$or:[{adminId:uid},{departmentAdminId:uid},{hodId:uid}]},{session}))return block('LEADERSHIP_PROTECTED','Assign a replacement before deleting department leadership.',user.role==='hod'?'CURRENT_HOD':user.role==='super_admin'?'SUPER_ADMIN_PROTECTED':'CURRENT_ADMIN');
 await authorizeAccountTarget(database,actor,user);
 if(await database.collection('students').countDocuments({mentorId:uid},{session})||await database.collection('enrollments').countDocuments({teacherId:uid},{session}))return block('HAS_HISTORY','Cannot permanently delete because protected academic/workflow history exists. Use Permanent Institutional Exit instead.');
 // Exact UID references in unknown collections are blockers too. Never silently
 // cascade marks, history, notifications, audits or previously archived setup.
 const owned=snapshot?(snapshot.offerings||[]).filter(o=>o.teacherId===uid):await database.collection('offerings').find({teacherId:uid},{session}).toArray(),ownedIds=new Set(owned.map(o=>o._id));
 const names=snapshot?Object.keys(snapshot).map(name=>({name})):await database.listCollections().toArray();
 if(ownedIds.size)for(const {name}of names)if(!name.startsWith('system.')&&!['bulkImportJobs','permanentDeleteJobs','provisioningJobs'].includes(name))for(const row of snapshot?snapshot[name]:await database.collection(name).find({},{session}).toArray())for(const id of ownedIds)if(!(name==='offerings'&&row._id===id)&&contains(row,id))return block('HAS_HISTORY','Cannot permanently delete because protected academic/workflow history exists. Use Permanent Institutional Exit instead.');
 const refs=[];for(const name of ['users','students','clearancePlans'])for(const row of snapshot?snapshot[name]||[]:await database.collection(name).find({_id:{$ne:uid}},{session}).toArray())if(row._id!==uid&&contains(row,uid))refs.push({collection:name,id:row._id});for(const{name}of snapshot?Object.keys(snapshot).map(name=>({name})):await database.listCollections().toArray())if(!name.startsWith('system.')&&!setup.has(name))for(const row of snapshot?snapshot[name]:await database.collection(name).find({},{session}).toArray())if(!(name==='offerings'&&ownedIds.has(row._id))&&contains(row,uid))refs.push({collection:name,id:row._id});
 if(refs.length||await database.collection('enrollments').countDocuments({studentId:uid,active:false},{session}))return block('HAS_HISTORY','Cannot permanently delete because protected academic/workflow history exists. Use Permanent Institutional Exit instead.',refs.some(r=>r.collection==='marks')?'HAS_ACADEMIC_HISTORY':'HAS_WORKFLOW_HISTORY');
 return{...result,offeringIds:[...ownedIds],classification:'SAFE_TO_DELETE',reason:'No retained history or protected responsibilities.'};
}

// Only enumerated relationships may be removed. An unrecognized reference
// blocks the operation until its ownership and history policy are understood.
const historical=new Set(['superAdminAudit','accountExitEvents','sectionTeacherHistory','departmentLeadershipHistory']);
const facultyRoles=new Set(['subject_faculty','mentor','hod']);
const activeRequest=r=>!['issued','cancelled','exited'].includes(r.status);
function references(value,ids){
 if(typeof value==='string')return ids.has(value);
 if(!value||typeof value!=='object'||value instanceof Date)return false;
 return Object.entries(value).some(([k,v])=>ids.has(k)||references(v,ids));
}
async function cascadePlan(database,actor,uid,session){
 const options={session},user=await database.collection('users').findOne({_id:uid},options);
 if(!user||uid===actor.uid||user.accountStatus==='deleting'||user.role!=='student'&&!facultyRoles.has(user.role))fail('This account is not eligible for cascade deletion.');
 if((await authorizeAccountTarget(database,actor,user)).role!=='super_admin')fail('Only Super Admin may cascade delete accounts.','permission-denied');
 const student=user.role==='student',staff=!student;
 const leadership=await database.collection('departments').findOne({$or:[{adminId:uid},{departmentAdminId:uid},{hodId:uid}]},options);
 if(leadership)fail('Assign replacement department leadership before cascade deletion.');
 const names=(await database.listCollections().toArray()).map(x=>x.name).filter(n=>!n.startsWith('system.')).sort();
 const ownRequests=student?await database.collection('noDueRequests').find({studentId:uid},options).toArray():[];
 const requestIds=new Set(ownRequests.map(r=>r._id));
 const ownedEnrollmentIds=new Set(student?(await database.collection('enrollments').find({studentId:uid},options).toArray()).map(r=>r._id):[]);
 const ids=new Set([uid,...requestIds,...ownedEnrollmentIds]),changes=[],counts={},blocked=[],warnings=[];
 const mark=(collection,row,action,fields={})=>{changes.push({collection,row,action,fields});const key=action+' '+collection;counts[key]=(counts[key]||0)+1;};
 for(const name of names){
   if(name==='permanentDeleteJobs')continue;
   for await(const row of database.collection(name).find({},options).sort({_id:1})){
     if(!references(row,ids))continue;
     const refUid=references(row,new Set([uid]));
     if(name==='users'&&row._id===uid){mark(name,row,'remove');continue;}
     if(historical.has(name)){mark(name,row,'retain history');continue;}
     if(name==='uniqueIdentities'&&row.uid===uid||name==='provisioningJobs'&&(row._id===uid||row.result?.uid===uid)){mark(name,row,'remove');continue;}
     if(['bulkImportJobs','bulkAccountJobs'].includes(name)&&row.state==='complete'){mark(name,row,'retain history');continue;}
     if(student&&(
       ['students','clearancePlans','officeStudentSearch'].includes(name)&&row._id===uid||
       ['enrollments','marks','assignments','noDueRequests','approvals','notifications','hallTickets'].includes(name)&&row.studentId===uid||
       ['marks'].includes(name)&&ownedEnrollmentIds.has(row._id)||
       ['approvals','notifications','hallTickets','workflowOverrides'].includes(name)&&(requestIds.has(row.requestId)||requestIds.has(row.__parent))||
       name==='notifications'&&row.__parent===uid
     )){mark(name,row,'remove');continue;}
     if(staff&&name==='students'&&(row.mentorId===uid||row.teacherIds?.includes(uid))){
       const fields={};if(row.mentorId===uid){fields.mentorId='';fields.mentorNeedsAttention=true;warnings.push('Affected students will have no assigned mentor.');}
       if(row.teacherIds?.includes(uid))fields.teacherIds=row.teacherIds.filter(x=>x!==uid);
       if(references({...row,...fields},ids)){blocked.push(name);continue;}
       mark(name,row,'detach',fields);continue;
     }
     if(staff&&name==='offerings'&&row.teacherId===uid){
       const fields={teacherId:'',active:false,teacherNeedsAttention:true};
       if(references({...row,...fields},ids)){blocked.push(name);continue;}
       mark(name,row,'detach',fields);warnings.push((row.subjectCode||'Class')+' Section '+(row.section||'—')+' will have no teacher and will be disabled until repaired.');continue;
     }
     if(staff&&name==='enrollments'&&(row.teacherId===uid||row.mentorId===uid)){
       const fields={};if(row.teacherId===uid)Object.assign(fields,{teacherId:'',active:false,teacherNeedsAttention:true});if(row.mentorId===uid)fields.mentorId='';
       if(references({...row,...fields},ids)){blocked.push(name);continue;}
       mark(name,row,'detach',fields);continue;
     }
     if(staff&&name==='sectionDetails'&&row.classTeacherId===uid){
       const fields={classTeacherId:null,classTeacherNeedsAttention:true};
       if(references({...row,...fields},ids)){blocked.push(name);continue;}
       mark(name,row,'detach',fields);warnings.push('Section '+row.section+' will have no class teacher.');continue;
     }
     if(staff&&(['departmentWorkflows','institutionPolicy'].includes(name)||name==='assignments')){
       const keys=(name==='assignments'?['teacherId']:['hodId','officeId','library','accounts','sports','physics_lab','chemistry_lab']).filter(k=>row[k]===uid);
       if(keys.length){const fields=Object.fromEntries(keys.map(k=>[k,'']));if(!references({...row,...fields},ids)){mark(name,row,'detach',{...fields,configurationNeedsAttention:true});warnings.push('A workflow or academic responsibility will be left unassigned.');continue;}}
     }
     if(staff&&name==='clearancePlans'&&refUid){mark(name,row,'remove');continue;}
     if(staff&&name==='notifications'&&row.__parent===uid){mark(name,row,'remove');continue;}
     if(staff&&name==='marks'&&row.teacherId===uid){
       mark(name,row,'detach',{teacherId:'',formerTeacher:{type:'deleted-faculty',id:uid}});continue;
     }
     if(staff&&name==='noDueRequests'){
       if(activeRequest(row)){mark(name,row,'cancel request');warnings.push('An affected No-Due request will be cancelled; the student can request clearance again after responsibilities are restored.');}
       else mark(name,row,'retain history');continue;
     }
     if(staff&&['approvals','notifications','hallTickets'].includes(name)&&refUid){mark(name,row,'retain history');continue;}
     blocked.push(name);
   }
 }
 // Include pending approvals on cancelled requests, even if they were assigned
 // to someone else, so the former request cannot remain actionable in a queue.
 const cancelledIds=changes.filter(x=>x.action==='cancel request').map(x=>x.row._id);
 if(cancelledIds.length){
   const already=new Set(changes.filter(x=>x.collection==='approvals').map(x=>x.row._id));
   for await(const row of database.collection('approvals').find({status:'pending',$or:[{requestId:{$in:cancelledIds}},{__parent:{$in:cancelledIds}}]},options).sort({_id:1})){
     if(!already.has(row._id))mark('approvals',row,'cancel approval');
     else {const item=changes.find(x=>x.collection==='approvals'&&x.row._id===row._id);item.action='cancel approval';counts['retain history approvals']--;counts['cancel approval approvals']=(counts['cancel approval approvals']||0)+1;}
   }
 }
 const fingerprint=createHash('sha256').update(JSON.stringify(changes.map(x=>[x.collection,x.action,x.row,x.fields]))).digest('hex');
 return {user,changes,counts,blocked:[...new Set(blocked)],warnings:[...new Set(warnings)],fingerprint};
}
export function permanentRemovalRoutes(app,{database,client,auth}){
 const validate=async(req)=>{if(req.actor.role!=='super_admin')fail('Only Super Admin may hard delete accounts.','permission-denied');const ids=req.body.accountIds;if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id)))fail('Select 1–100 unique accounts.');for(const uid of ids){const target=await database.collection('users').findOne({_id:uid});if(target&&target._id!==req.actor.uid&&target.role!=='super_admin'&&(await authorizeAccountTarget(database,req.actor,target)).role!=='super_admin')fail('Only Super Admin may hard delete accounts.','permission-denied');}return ids;};
 app.post('/api/admin/accounts/delete-preflight',async(req,res)=>{const ids=await validate(req),names=(await database.listCollections().toArray()).filter(c=>!c.name.startsWith('system.')).map(c=>c.name),snapshot=Object.fromEntries(await Promise.all(names.map(async n=>[n,await database.collection(n).find({}).toArray()]))),rows=await Promise.all(ids.map(uid=>classify(database,req.actor,uid,null,null,snapshot)));if(req.body.single===true&&ids.length===1){const row=rows[0];if(row.classification==='SAFE_TO_DELETE'&&(row.offeringIds?.length||(snapshot.enrollments||[]).some(e=>e.studentId===row.uid)))Object.assign(row,{classification:'HAS_HISTORY',category:'HAS_DEPENDENCIES',reason:'Mapped operational records require cascade review.'});}res.json({rows,safe:rows.filter(r=>r.classification==='SAFE_TO_DELETE').length,selected:rows.length});});
 app.post('/api/admin/accounts/cascade-preflight',async(req,res)=>{
  const [uid,...extra]=await validate(req);if(extra.length)fail('Review one account at a time.');
  const pending=await database.collection('users').findOne({_id:uid,accountStatus:'deleting'});
  if(pending){
   const job=await database.collection('permanentDeleteJobs').findOne({_id:pending.permanentDeleteOperation,kind:'cascade',actorUid:req.actor.uid});
   if(!job)fail('Another operation owns this removal.');
   return res.json({uid,name:pending.name,...job.preview,resumeRequestId:job.requestId});
  }
  const plan=await cascadePlan(database,req.actor,uid);
  res.json({uid,name:plan.user.name,counts:plan.counts,blocked:plan.blocked,warnings:plan.warnings,fingerprint:plan.fingerprint});
 });
 app.post('/api/admin/accounts/cascade-delete',async(req,res)=>{
  const [uid,...extra]=await validate(req),{confirmation,typed,requestId,fingerprint}=req.body,reason=typeof req.body.reason==='string'?req.body.reason.trim():'';
  if(extra.length||confirmation!==true||typed!=='DELETE'||!reason||reason.length>1000||!/^[A-Za-z0-9_-]{8,100}$/.test(requestId||'')||!/^[a-f0-9]{64}$/.test(fingerprint||''))fail('Review one account, provide a reason, acknowledge permanent deletion and type DELETE.');
  const id=createHash('sha256').update(req.actor.uid+':cascade:'+requestId).digest('hex'),jobs=database.collection('permanentDeleteJobs');
  let job=await jobs.findOne({_id:id});
  if(job&&(job.accountIds[0]!==uid||job.preview.fingerprint!==fingerprint))fail('Removal request belongs to another preview.');
  if(job?.state==='complete')return res.json(job.result);
  const verifyIdentity=async email=>{try{const identity=await auth.getUser(uid);if(identity.uid!==uid||!email||identity.email?.toLowerCase()!==email.toLowerCase())fail('Firebase UID/email mismatch; delete blocked.');return true;}catch(error){if(error.code==='auth/user-not-found')return false;throw error;}};
  if(!job){
   const user=await database.collection('users').findOne({_id:uid});
   if(!user)fail('Account no longer exists.');
   if(user.firebaseUid&&user.firebaseUid!==uid)fail('Stored Firebase UID mismatch; delete blocked.');
   await verifyIdentity(user.email);
   const session=client.startSession();
   try{await session.withTransaction(async()=>{
    const prior=await jobs.findOne({_id:id},{session});if(prior){if(prior.accountIds[0]!==uid||prior.preview.fingerprint!==fingerprint)fail('Removal request belongs to another preview.');return;}
    const plan=await cascadePlan(database,req.actor,uid,session);
    if(plan.user.email!==user.email||plan.fingerprint!==fingerprint)fail('Dependencies changed. Review a fresh preview.','failed-precondition');
    if(plan.blocked.length)fail('Unresolved references in: '+plan.blocked.join(', ')+'. No records were deleted.','failed-precondition');
    const options={session},at=new Date();
    await database.collection('users').updateOne({_id:uid},{$set:{accountStatus:'deleting',permanentDeleteOperation:id}},options);
    await database.collection('superAdminAudit').insertOne({_id:'deleted_account_'+uid,action:'ACCOUNT_DELETION_TOMBSTONE',target:uid,role:plan.user.role,label:plan.user.role==='student'?'Former Student':'Former Faculty',deletedAt:at,timestamp:at},options);
    const cancelledIds=plan.changes.filter(change=>change.action==='cancel request').map(change=>change.row._id);
    if(cancelledIds.length)await database.collection('notifications').updateMany({requestId:{$in:cancelledIds}},{$set:{archived:true,archivedAt:at}},options);
    for(const change of plan.changes){
      const {collection,row,action,fields}=change,table=database.collection(collection),filter={_id:row._id};
      if(collection==='users'||action==='retain history')continue;
      if(action==='remove')await table.deleteOne(filter,options);
      if(action==='detach')await table.updateOne(filter,{$set:fields},options);
      if(action==='cancel request')await table.updateOne(filter,{$set:{status:'cancelled',previousStatus:row.status,cancelledAt:at,cancelledBy:req.actor.uid,cancellationReason:'Assigned faculty permanently deleted',approvalStates:Object.fromEntries(Object.entries(row.approvalStates||{}).map(([k,v])=>[k,v==='pending'?'cancelled':v]))}},options);
      if(action==='cancel approval')await table.updateOne(filter,{$set:{status:'cancelled',previousStatus:'pending',cancelledAt:at,cancelledBy:req.actor.uid}},options);
    }
    const preview={fingerprint,counts:plan.counts,blocked:plan.blocked,warnings:plan.warnings};
    await jobs.insertOne({_id:id,kind:'cascade',accountIds:[uid],actorUid:req.actor.uid,requestId,state:'mongo-complete',preview,createdAt:at},options);
    await database.collection('superAdminAudit').insertOne({_id:'cascade_'+id,action:'ACCOUNT_CASCADE_DELETE',actorUid:req.actor.uid,actorRole:req.actor.role,targets:[uid],reason,counts:plan.counts,timestamp:at,summary:'Removed operational mappings; Firebase removal journaled.'},options);
   });}finally{await session.endSession();}
   job=await jobs.findOne({_id:id});
  }
  if(job.state==='complete')return res.json(job.result);
  const user=await database.collection('users').findOne({_id:uid});
  if(!user||user.permanentDeleteOperation!==id)fail('Removal operation changed.','failed-precondition');
  if(await verifyIdentity(user.email)){try{await auth.updateUser(uid,{disabled:true});await auth.revokeRefreshTokens(uid);await auth.deleteUser(uid);}catch(error){if(error.code!=='auth/user-not-found')throw error;}}
  const result={deleted:1,uid},finish=client.startSession();
  try{await finish.withTransaction(async()=>{
   const options={session:finish};
   await database.collection('users').deleteOne({_id:uid,permanentDeleteOperation:id},options);
   await jobs.updateOne({_id:id},{$set:{state:'complete',result,completedAt:new Date()}},options);
  });}finally{await finish.endSession();}
  res.json(result);
 });
 app.post('/api/admin/accounts/permanent-delete',async(req,res)=>{
  const ids=await validate(req);if(req.body.confirmation!==true||!/^[A-Za-z0-9_-]{8,100}$/.test(req.body.requestId||''))fail('Checkbox confirmation and a stable request ID are required.');const id=createHash('sha256').update(req.actor.uid+':'+req.body.requestId).digest('hex'),jobs=database.collection('permanentDeleteJobs'),old=await jobs.findOne({_id:id});if(old&&JSON.stringify(old.accountIds)!==JSON.stringify(ids))fail('Delete request ID belongs to another selection.');if(old?.state==='complete')return res.json(old.result);await jobs.updateOne({_id:id},{$setOnInsert:{actorUid:req.actor.uid,accountIds:ids,state:'pending',createdAt:new Date()}},{upsert:true});const rows=[];
  for(const uid of ids){try{const previous=old?.result?.rows.find(r=>r.uid===uid&&r.deleted);if(previous){rows.push(previous);continue;}let entry;const session=client.startSession();try{await session.withTransaction(async()=>{entry=await classify(database,req.actor,uid,session,id);if(entry.classification!=='SAFE_TO_DELETE')return;await database.collection('users').updateOne({_id:uid},{$set:{accountStatus:'deleting',permanentDeleteOperation:id}},{session});await database.collection('students').updateOne({_id:uid},{$set:{accountStatus:'deleting'}},{session});});}finally{await session.endSession();}
   if(entry.classification==='MISSING'){rows.push({...entry,deleted:true,alreadyRemoved:true});continue;}if(entry.classification!=='SAFE_TO_DELETE'){rows.push({...entry,deleted:false});continue;}
   const user=await database.collection('users').findOne({_id:uid});if(user.permanentDeleteOperation!==id)fail('Another removal owns this account.');try{const identity=await auth.getUser(uid);if(identity.email?.toLowerCase()!==user.email?.toLowerCase())fail('Firebase UID/email mismatch; delete blocked.');await auth.updateUser(uid,{disabled:true});await auth.revokeRefreshTokens(uid);await auth.deleteUser(uid);}catch(error){if(error.code!=='auth/user-not-found')throw error;}
   const finish=client.startSession();try{await finish.withTransaction(async()=>{const fresh=await database.collection('users').findOne({_id:uid},{session:finish});if(!fresh)return;if(fresh.permanentDeleteOperation!==id)fail('Removal operation changed.');await database.collection('enrollments').deleteMany({studentId:uid},{session:finish});if(entry.offeringIds?.length)await database.collection('offerings').deleteMany({_id:{$in:entry.offeringIds},teacherId:uid},{session:finish});for(const collection of ['students','users','clearancePlans','officeStudentSearch'])await database.collection(collection).deleteOne({_id:uid},{session:finish});await database.collection('uniqueIdentities').deleteMany({uid},{session:finish});await database.collection('provisioningJobs').deleteMany({$or:[{_id:uid},{'result.uid':uid}]},{session:finish});});}finally{await finish.endSession();}
   rows.push({...entry,deleted:true});
  }catch(error){rows.push({uid,deleted:false,classification:'RETRY_REQUIRED',reason:error.message});}}
  const result={rows,deleted:rows.filter(r=>r.deleted).length,skipped:rows.filter(r=>!r.deleted).length,retryRequired:rows.some(r=>r.classification==='RETRY_REQUIRED')};await jobs.updateOne({_id:id},{$set:{result,state:result.retryRequired?'pending':'complete'}});if(result.deleted)await database.collection('superAdminAudit').updateOne({_id:'delete_'+id},{$setOnInsert:{actorUid:req.actor.uid,actorRole:req.actor.role,action:'ACCOUNT_HARD_DELETED',operationType:'hard-delete',reason:String(req.body.reason||'Unused identity without protected history').slice(0,1000),targets:rows.filter(r=>r.deleted).map(r=>({uid:r.uid,name:r.name,email:r.email})),summary:result.deleted+' safe accounts permanently removed; history/protected accounts retained.',timestamp:new Date()}},{upsert:true});res.json(result);
 });
}
