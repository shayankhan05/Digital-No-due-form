import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {recordDigest} from './presentation-reset.js';
import {verifiedDemoStudent,studentIdentityKey} from './student-import-reconciliation.js';
import {sealAdministrativeBackup} from './administrative-backup.js';
const fail=(m,c='invalid-argument')=>{throw Object.assign(Error(m),{code:c});};
const email=s=>String(s||'').trim().toLowerCase();
const optional=async f=>{try{return await f();}catch(e){if(e.code==='auth/user-not-found')return null;throw e;}};
const key=row=>[['email',row.collegeEmail],['usn',row.usn],['loginId',row.usn],['auid',row.auid]].map(([k,v])=>studentIdentityKey(k,v));
const privateCollections=new Set(['superAdminAudit','presentationWorkflowArchives','presentationIdentityJournal','testDataHistoricalAttributions','administrativeBackups','studentIdentityArchives','studentReplacementJobs','bulkImportJobs','accountExitEvents','testDataCleanupBackups','testDataCleanupJobs']);
export async function replacementPlan({store,auth,service,actor,input,uid}){
 if(actor.role!=='super_admin')fail('Only Super Admin can replace a demo student.','permission-denied');
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid||''))fail('Select an exact existing identity.');
 const db=store.database,opt={session:store.session},user=await db.collection('users').findOne({_id:uid},opt),student=await db.collection('students').findOne({_id:uid},opt);
 if(user?.role!=='student'||!student||!await verifiedDemoStudent(store,uid,student,user))fail('Current explicit test provenance is required for both identity records.');
 if(actor.managementDepartmentId&&student.departmentId!==actor.managementDepartmentId)fail('Wrong department.','permission-denied');
 const row=await service.prepareStudentReplacement(input);
 if(!row.auid||row.usn!==student.usn||row.departmentId!==student.departmentId)fail('Confirm the official AUID, matching USN and department.');
 if(email(row.collegeEmail)===email(user.email)||row.phone===student.phone)fail('Supply the real incoming contact details. Dummy email and phone cannot be inherited.');
 const others=await db.collection('students').find({_id:{$ne:uid},$or:[{usn:row.usn},{auid:row.auid},{email:row.collegeEmail},{phone:row.phone}]}).collation({locale:'en',strength:2}).toArray();
 const otherUsers=await db.collection('users').find({_id:{$ne:uid},$or:[{email:row.collegeEmail},{facultyId:row.usn},{phone:row.phone}]}).collation({locale:'en',strength:2}).toArray();
 const reservations=await db.collection('uniqueIdentities').find({_id:{$in:key(row)},uid:{$ne:uid}},opt).toArray();
 if(others.length||otherUsers.length||reservations.length)fail('Incoming USN, AUID, email or phone belongs to another identity.','already-exists');
 if(await optional(()=>auth.getUserByEmail(row.collegeEmail)))fail('Incoming Firebase email already exists. Review that legitimate account separately; it will never be adopted automatically.','already-exists');
 const oldAuth=await optional(()=>auth.getUser(uid));
 if(oldAuth&&email(oldAuth.email)!==email(user.email))fail('Dummy Firebase identity does not match its application account.');
 const records={users:[user],students:[student]};
 for(const [name,q]of Object.entries({enrollments:{studentId:uid},marks:{studentId:uid},clearancePlans:{_id:uid},noDueRequests:{studentId:uid},officeStudentSearch:{_id:uid},uniqueIdentities:{uid},provisioningJobs:{$or:[{_id:uid},{'result.uid':uid}]},testDataRegistry:{recordId:uid}})){
  records[name]=await db.collection(name).find(q,opt).sort({_id:1}).toArray();
 }
 const requests=records.noDueRequests.map(r=>r._id);
 for(const name of ['approvals','notifications','hallTickets','workflowOverrides'])records[name]=await db.collection(name).find({$or:[{studentId:uid},{__parent:{$in:[uid,...requests]}},{requestId:{$in:requests}}]},opt).sort({_id:1}).toArray();
 // Unknown shared references require a review. Never recursively rewrite other records.
 const activeImports=await db.collection('bulkImportJobs').find({state:{$ne:'complete'}},opt).toArray();if(activeImports.some(r=>JSON.stringify(r).includes(uid)))fail('An import still references this student. Finish or cancel that import first.');
 for(const {name}of await db.listCollections({},{nameOnly:true}).toArray()){
  if(name.startsWith('system.')||privateCollections.has(name))continue;
  const owned=new Set((records[name]||[]).map(r=>String(r._id)));
  if((await db.collection(name).find({},opt).toArray()).some(r=>!owned.has(String(r._id))&&JSON.stringify(r).includes(uid)))fail('Unreviewed dependency in '+name+'. Replacement blocked.');
 }
 const sharedImportJobs=await db.collection('bulkImportJobs').find({'results.uid':uid},opt).sort({_id:1}).toArray();
 const fingerprint=recordDigest({records,row,sharedImportJobs});
 return {uid,row,records,sharedImportJobs,fingerprint,oldFirebaseExists:!!oldAuth,summary:Object.fromEntries(Object.entries(records).map(([n,r])=>[n,r.length]))};
}
export function studentReplacementRoutes(app,{store,database,client,auth,service,backupKey,sendActivation}){
 const jobs=database.collection('studentReplacementJobs');
 app.post('/api/student-replacements/preview',async(req,res)=>{
  const p=await replacementPlan({store,auth,service,actor:req.actor,input:req.body.row,uid:req.body.uid});
  const {offerings,...incoming}=p.row;
  res.json({fingerprint:p.fingerprint,existing:{...p.records.students[0],email:p.records.users[0].email},incoming,counts:p.summary,firebase:{exists:p.oldFirebaseExists},preservation:'Current placement will be rebuilt from current offerings. Dummy marks, requests and credentials will be archived, never transferred.'});
 });
 app.post('/api/student-replacements/confirm',async(req,res)=>{
  const actor=req.actor,{uid,fingerprint,confirmation,finalConfirmation}=req.body,reason=String(req.body.reason||'').trim();
  if(actor.role!=='super_admin')fail('Only Super Admin can replace a demo student.','permission-denied');
  if(confirmation!==true||finalConfirmation!==true||reason.length<10||reason.length>2000||!/^[a-f0-9]{64}$/.test(fingerprint||'')||!/^[A-Za-z0-9_-]{1,128}$/.test(uid||''))fail('Confirm verified test provenance, give a reason, and confirm the reviewed replacement.');
  const id=createHash('sha256').update('student-replacement:'+uid).digest('hex');
  let job=await jobs.findOne({_id:id});
  if(job&&(job.actorId!==actor.uid||job.fingerprint!==fingerprint))fail('A different replacement operation owns this identity.','already-exists');
  if(!job){
   const p=await replacementPlan({store,auth,service,actor,input:req.body.row,uid});
   if(p.fingerprint!==fingerprint)fail('Preview changed. Validate again.','already-exists');
   const backup=sealAdministrativeBackup({...p.records,sharedImportJobs:p.sharedImportJobs},backupKey),newUid='real_'+randomUUID().replaceAll('-',''),{offerings,...row}=p.row;
   const session=client.startSession();try{await session.withTransaction(async()=>{
    if(await jobs.findOne({_id:id},{session}))return;
    const liveUser=await database.collection('users').findOne({_id:uid},{session});
    if(recordDigest(liveUser)!==recordDigest(p.records.users[0]))fail('Existing account changed. Preview again.');
    await database.collection('administrativeBackups').insertOne({...backup,kind:'STUDENT_REPLACEMENT',operation:id},{session});
    await jobs.insertOne({_id:id,actorId:actor.uid,oldUid:uid,newUid,fingerprint,row,reason,backupId:backup._id,state:'prepared',createdAt:new Date()},{session});
   });}finally{await session.endSession();}
   job=await jobs.findOne({_id:id});
  }
  if(actor.managementDepartmentId&&job.row.departmentId!==actor.managementDepartmentId)fail('Wrong department.','permission-denied');
  if(job.state==='complete')return res.json({status:'complete',uid:job.newUid,duplicate:true});
  if(job.state==='prepared'){
   const newAuth=await optional(()=>auth.getUser(job.newUid));
   if(!newAuth){try{await auth.createUser({uid:job.newUid,email:job.row.collegeEmail,displayName:job.row.name,password:randomBytes(48).toString('base64url'),disabled:true,emailVerified:false});}catch(e){if(e.code!=='auth/uid-already-exists')throw e;const same=await auth.getUser(job.newUid);if(email(same.email)!==job.row.collegeEmail||!same.disabled)fail('New Firebase identity changed during provisioning.');}}
   else if(email(newAuth.email)!==job.row.collegeEmail||!newAuth.disabled)fail('New Firebase identity has changed; manual review is required.');
   const p=await replacementPlan({store,auth:{...auth,getUser:auth.getUser.bind(auth),getUserByEmail:async value=>{const u=await auth.getUserByEmail(value);if(u.uid===job.newUid)throw Object.assign(Error('not found'),{code:'auth/user-not-found'});return u;}},service,actor,input:job.row,uid});
   if(p.fingerprint!==fingerprint)fail('The demo record or its dependencies changed after backup. Review before continuing.');
   const session=client.startSession();try{await session.withTransaction(async()=>{
    const opt={session},liveJob=await jobs.findOne({_id:id},opt);if(liveJob.state!=='prepared')return;
    for(const [name,rows]of Object.entries(p.records)){
     const current=await database.collection(name).find({_id:{$in:rows.map(r=>r._id)}},opt).sort({_id:1}).toArray();
     const before=[...rows].sort((a,b)=>String(a._id).localeCompare(String(b._id)));
     if(recordDigest(current.sort((a,b)=>String(a._id).localeCompare(String(b._id))))!==recordDigest(before))fail('A backed-up dependency changed. Replacement stopped.');
    }
    await database.collection('studentIdentityArchives').insertOne({_id:id,oldUid:uid,newUid:job.newUid,backupId:job.backupId,reason,actorId:actor.uid,createdAt:new Date(),identity:{name:p.records.students[0].name,usn:p.records.students[0].usn},recordCounts:p.summary},opt);
    for(const [name,rows]of Object.entries(p.records))if(rows.length)await database.collection(name).deleteMany({_id:{$in:rows.map(r=>r._id)}},opt);
    await database.collection('bulkImportJobs').updateMany({'results.uid':uid},{$set:{identitySuperseded:true}},opt);
    const r=job.row,at=new Date(),profile={name:r.name,email:r.collegeEmail,phone:r.phone,role:'student',department:r.department,departmentId:r.departmentId,scope:'department',scheme:r.scheme,accountStatus:'active',dataOrigin:'production',createdAt:at,firebaseUid:job.newUid,replacementOperation:id,...(r.strictDepartmentScope?{strictDepartmentScope:true}:{})};
    await database.collection('users').insertOne({_id:job.newUid,...profile},opt);
    await database.collection('students').insertOne({_id:job.newUid,uid:job.newUid,...profile,usn:r.usn,auid:r.auid,semester:r.semester,section:r.section,mentorId:r.mentorId},opt);
    for(const k of key(r))await database.collection('uniqueIdentities').insertOne({_id:k,uid:job.newUid,createdAt:at},opt);
    await database.collection('superAdminAudit').insertOne({_id:randomUUID(),action:'DEMO_STUDENT_REPLACED',actorId:actor.uid,target:job.newUid,oldUid:uid,backupId:job.backupId,reason,timestamp:at},opt);
    await jobs.updateOne({_id:id},{$set:{state:'mongo-complete'}},opt);
   });}finally{await session.endSession();}
  }
  // Access is blocked in Mongo first; resumable steps never reuse/reset an old password.
  const oldAuth=await optional(()=>auth.getUser(uid));if(oldAuth){await auth.updateUser(uid,{disabled:true});await auth.revokeRefreshTokens(uid);}
  const profile=(await store.doc('students/'+job.newUid).get()).data();
  await service.rebuildStudentMappings(job.newUid,profile,null,{preserveExisting:true});
  await auth.updateUser(job.newUid,{disabled:false});
  let activation='sent';
  try{await sendActivation(job.row.collegeEmail,await auth.generatePasswordResetLink(job.row.collegeEmail),(await store.doc('settings/institution').get()).data()||{});}catch{activation='delivery-failed';}
  await jobs.updateOne({_id:id},{$set:{state:'complete',activation,completedAt:new Date()}});
  res.json({status:'complete',uid:job.newUid,oldUid:uid,activation,oldFirebaseDisabled:true,marksTransferred:0,requestsTransferred:0});
 });
}
