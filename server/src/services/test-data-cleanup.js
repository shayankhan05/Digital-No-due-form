import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {EJSON} from 'bson';
import {recordDigest} from './presentation-reset.js';
import {auditIntegrity} from './integrity-audit.js';
import {isInactive} from './account-removal.js';

const eligible=new Set(['users','subjects','offerings','enrollments','marks','assignments','clearancePlans','noDueRequests','approvals','notifications','workflowOverrides','hallTickets','uniqueIdentities','provisioningJobs']);
const internal=new Set(['testDataRegistry','testDataCleanupJobs','testDataCleanupBackups','testDataHistoricalAttributions']);
const fail=(message,code='invalid-argument')=>{throw Object.assign(Error(message),{code});};
const bson=value=>EJSON.stringify(value,{relaxed:false});
export const testRecordDigest=value=>createHash('sha256').update(bson(value)).digest('hex');
const rowKey=(collection,id)=>collection+':'+bson(id);
const counts=rows=>rows.reduce((out,r)=>(out[r.collection]=(out[r.collection]||0)+1,out),{});
const knownLegacy=x=>x.collection==='users'&&/^FAC20[1-5]$/i.test(x.row.facultyId||'')&&(x.row.department==='ISE'||x.row.departmentId==='dept_ISE')||x.collection==='offerings'&&['BCS511','BCS512','BCS513','BCS514','BCS515'].includes(x.row.subjectCode)&&Number(x.row.semester)===5&&(x.row.department==='ISE'||x.row.departmentId==='dept_ISE');

export function testDataPlan(snapshot){
 const all=Object.entries(snapshot).filter(([name])=>!internal.has(name)).flatMap(([collection,rows])=>rows.map(row=>({collection,row})));
 const index=new Map(all.map(x=>[rowKey(x.collection,x.row._id),x]));
 const marked=new Set(),targets=[],blocked=[];
 const block=(collection,reason)=>blocked.push({collection,reason});
 for(const entry of snapshot.testDataRegistry||[]){
  if(entry.origin!=='test')continue;
  const key=rowKey(entry.collection,entry.recordId),x=index.get(key);
  if(!x){block(entry.collection,'Reviewed record is missing. Reconcile the registry.');continue;}
  if(marked.has(key)){block(entry.collection,'Duplicate reviewed provenance.');continue;}
  if(!eligible.has(entry.collection)||!entry.evidence||entry.digest!==testRecordDigest(x.row)){block(entry.collection,'Provenance is unsupported or stale. Review the current record.');continue;}
  if(x.row.dataOrigin==='production'||x.row.dataOrigin==='historical-production'){block(entry.collection,'The record is explicitly protected.');continue;}
  if(entry.collection==='users'&&(!['subject_faculty','mentor'].includes(x.row.role)||!isInactive(x.row)||!x.row.email||x.row.firebaseUid&&x.row.firebaseUid!==x.row._id)){block(entry.collection,'Only inactive, verified test faculty accounts can be purged.');continue;}
  marked.add(key);targets.push(x);
 }
 const faculty=new Set(targets.filter(x=>x.collection==='users').map(x=>x.row._id));
 // UID-owned reservations and finished provisioning jobs are exclusive to that identity.
 for(const x of all){
  const r=x.row,uid=x.collection==='uniqueIdentities'?r.uid:x.collection==='provisioningJobs'&&r.state==='complete'?r.result?.uid:undefined;
  const key=rowKey(x.collection,r._id);
  if(faculty.has(uid)&&!marked.has(key)&&!['production','historical-production'].includes(r.dataOrigin)){
   marked.add(key);targets.push(x);
  }
 }
 const tokens=new Set(targets.flatMap(({collection,row})=>[typeof row._id==='string'?row._id:'',...(collection==='users'?[row.email,row.facultyId]:[])].filter(Boolean).map(x=>String(x).toLowerCase())));
 const codes=new Set(targets.filter(x=>x.collection==='subjects').map(x=>String(x.row.code).toLowerCase()));
 const offeringIds=new Set(targets.filter(x=>x.collection==='offerings').map(x=>x.row._id));
 const pointsToTarget=row=>{const value=bson(row).toLowerCase();return [...tokens].some(t=>value.includes(t))||[...codes].some(code=>value.includes(JSON.stringify(code)));};
 const requestIds=new Set(targets.filter(x=>x.collection==='noDueRequests').map(x=>x.row._id));
 for(const {collection,row} of targets){
  if(['marks','enrollments','assignments'].includes(collection)&&!offeringIds.has(row.offeringId))block(collection,'This record belongs to an offering that will be retained.');
  if(collection==='noDueRequests'&&Object.values(row.approvalItems||{}).some(item=>item?.offeringId&&!offeringIds.has(item.offeringId)))block(collection,'This request includes a retained offering.');
  if(['approvals','workflowOverrides','hallTickets','notifications'].includes(collection)){
   const requestId=row.requestId||(collection==='approvals'?row.__parent:null);
   if(!requestId||!requestIds.has(requestId))block(collection,'This workflow record is not owned by a reviewed test request.');
  }
 }
 const detach=[],retainedHistory=[];
 const attributions=new Map((snapshot.testDataHistoricalAttributions||[])
  .filter(archive=>archive.digest===testRecordDigest(archive.records)&&Array.isArray(archive.records?.attributions))
  .flatMap(archive=>archive.records.attributions.map(a=>[rowKey(a.collection,a.id),a])));
 // Operational references still block. A reviewed historical attribution may
 // retain an old ID only when the exact source row and its snapshot match.

 for(const x of all){
  if(marked.has(rowKey(x.collection,x.row._id))||!pointsToTarget(x.row))continue;
  const r=x.row,patch={};
  const attribution=attributions.get(rowKey(x.collection,r._id));
  if(attribution?.digest===testRecordDigest(r)){
   const historicalMark=x.collection==='marks'&&faculty.has(r.updatedBy)&&!pointsToTarget({...r,updatedBy:null})&&attribution.faculty?.name&&attribution.faculty?.employeeId;
   const historicalAudit=x.collection==='superAdminAudit'&&['SUPER_ADMIN_OVERRIDE','MENTOR_CAPABILITY_CHANGED'].includes(r.action)&&r.timestamp instanceof Date;
   if(historicalMark||historicalAudit){retainedHistory.push(x);continue;}
  }
  // Presentation archives are detached snapshots, not live workflow records.
  // Only a digest-verified snapshot with readable approval identities qualifies.
  if(x.collection==='presentationWorkflowArchives'&&r.backupReference&&Array.isArray(r.records?.noDueRequests)&&r.records.noDueRequests.length&&r.digest===recordDigest(r.records)){
   const items=r.records.noDueRequests.flatMap(request=>Object.values(request.approvalItems||{}));
   const referenced=items.filter(item=>faculty.has(item.teacherUid||item.approverId)||offeringIds.has(item.offeringId));
   if(referenced.length&&referenced.every(item=>item.teacherName&&item.subjectCode&&(item.subjectName||item.label))){retainedHistory.push(x);continue;}
  }
  if(x.collection==='students'){
   if(Array.isArray(r.teacherIds))patch.teacherIds=r.teacherIds.filter(id=>!faculty.has(id));
   if(Array.isArray(r.offeringIds))patch.offeringIds=r.offeringIds.filter(id=>!offeringIds.has(id));
  }else if(x.collection==='clearancePlans'&&r.items&&typeof r.items==='object'){
   const removed=Object.keys(r.items).filter(k=>offeringIds.has(r.items[k]?.offeringId));
   if(removed.length){
    patch.items=Object.fromEntries(Object.entries(r.items).filter(([k])=>!removed.includes(k)));
    patch.initialStates=Object.fromEntries(Object.entries(r.initialStates||{}).filter(([k])=>!removed.includes(k)));
    const remaining=new Set(Object.values(patch.items).map(i=>i?.approverId));
    const obsolete=new Set(removed.map(k=>r.items[k]?.approverId));
    patch.approverIds=(r.approverIds||[]).filter(id=>!obsolete.has(id)||remaining.has(id));
    if(!Object.values(patch.items).some(i=>i?.offeringId))patch.valid=false;
   }
  }
  if(Object.keys(patch).length&&!pointsToTarget({...r,...patch}))detach.push({...x,patch});
  else block(x.collection,'A retained record references a purge target.');
 }
 const detached=new Map(detach.map(x=>[rowKey(x.collection,x.row._id),x.patch]));
 const next=Object.fromEntries(Object.entries(snapshot).map(([n,rows])=>[n,rows.filter(r=>!marked.has(rowKey(n,r._id))).map(r=>detached.has(rowKey(n,r._id))?{...r,...detached.get(rowKey(n,r._id))}:r)]));
 const existing=new Set(auditIntegrity(snapshot).issues.map(bson));
 const introduced=auditIntegrity(next).issues.filter(issue=>!existing.has(bson(issue)));
 if(introduced.length)block('integrity','The purge would introduce integrity issues.');
 if(targets.length>500)block('scope','Review no more than 500 records per purge.');
 const ordered=targets.sort((a,b)=>rowKey(a.collection,a.row._id).localeCompare(rowKey(b.collection,b.row._id)));
 const grouped=Object.entries(blocked.reduce((out,b)=>{const k=b.collection+'|'+b.reason;out[k]=(out[k]||0)+1;return out;},{})).map(([key,count])=>{const [collection,reason]=key.split('|');return{collection,reason,count};});
 const summary={counts:counts(ordered),total:ordered.length,detach:counts(detach),retainedHistory:counts(retainedHistory),blocked:grouped,unclassifiedLegacy:counts(all.filter(x=>knownLegacy(x)&&!marked.has(rowKey(x.collection,x.row._id)))),integrityIssues:existing.size};
 return {targets:ordered,detach,retainedHistory,summary:{...summary,fingerprint:testRecordDigest({ordered,detach,retainedHistory,summary})},next};
}

const order=['notifications','workflowOverrides','approvals','hallTickets','noDueRequests','clearancePlans','marks','enrollments','assignments','offerings','subjects','uniqueIdentities','provisioningJobs','users'];
export async function readDatabase(db,names,session){
 const rows={};
 for(const name of names)rows[name]=await db.collection(name).find({},{session}).sort({_id:1}).toArray();
 return rows;
}
export async function verifiedTestAuth(auth,users,{allowActive=false}={}){
 const out=[];
 const optional=async fn=>{try{return await fn();}catch(e){if(e.code==='auth/user-not-found')return null;throw e;}};
 for(const u of users){
  const uid=await optional(()=>auth.getUser(u.uid)),email=await optional(()=>auth.getUserByEmail(u.email));
  if(Boolean(uid)!==Boolean(email)||uid&&(uid.uid!==u.uid||email.uid!==u.uid||uid.email?.toLowerCase()!==u.email.toLowerCase()||!allowActive&&!uid.disabled))fail('A test Firebase account is active or does not match its UID and email.');
  out.push({uid:u.uid,exists:!!uid,disabled:uid?.disabled===true});
 }
 return out;
}
function encryptedBackup(value,key){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),plain=Buffer.from(bson(value)),data=Buffer.concat([cipher.update(plain),cipher.final()]),tag=cipher.getAuthTag();
 const verifier=createDecipheriv('aes-256-gcm',key,iv);verifier.setAuthTag(tag);
 if(!Buffer.concat([verifier.update(data),verifier.final()]).equals(plain))fail('Encrypted backup verification failed.');
 return {iv:iv.toString('base64'),tag:tag.toString('base64'),data:data.toString('base64'),format:'ejson-aes-256-gcm-v1'};
}
export async function cleanupCollectionNames(database){
 return [...new Set([...(await database.listCollections().toArray())
  .filter(c=>!c.name.startsWith('system.')&&!['testDataCleanupBackups','testDataCleanupJobs'].includes(c.name)).map(c=>c.name),'testDataRegistry'])].sort();
}

export async function writeTestPurge({database,session,plan,key,actorUid,registry,revisions=[],archive}){
 if(key?.length!==32||plan.summary.blocked.length||!plan.targets.length)fail('A verified scan and backup key are required.');
 const id=plan.summary.fingerprint;
 const users=plan.targets.filter(x=>x.collection==='users').map(({row})=>({uid:row._id,email:row.email}));
 const backup=encryptedBackup({records:plan.targets,detached:plan.detach,registry,revisions},key);
 if(backup.data.length>12_000_000)fail('The encrypted backup exceeds the safe size limit.');
 const tokens=[...new Set(plan.targets.flatMap(({collection,row})=>[
  typeof row._id==='string'?row._id:null,
  ...(collection==='users'?[row.email,row.facultyId]:[]),
  ...(collection==='subjects'?[JSON.stringify(String(row.code))]:[]),
 ]).filter(Boolean).map(x=>String(x).toLowerCase()))];
 await database.collection('testDataCleanupBackups').insertOne({_id:id,createdAt:new Date(),...backup},{session});
 if(archive){
  await database.collection('testDataHistoricalAttributions').insertOne({...archive,backupId:id,createdAt:new Date()},{session});
  await database.collection('testDataRegistry').insertMany(registry,{session});
 }
 for(const {collection,before,after} of revisions){
  const table=database.collection(collection);
  const result=after?await table.replaceOne({_id:before._id},after,{session}):await table.deleteOne({_id:before._id},{session});
  if((after?result.matchedCount:result.deletedCount)!==1)fail('A migration record changed.');
 }
 for(const collection of new Set(plan.detach.map(x=>x.collection))){
  const changes=plan.detach.filter(x=>x.collection===collection);
  const result=await database.collection(collection).bulkWrite(changes.map(x=>({
   updateOne:{filter:{_id:x.row._id},update:{$set:x.patch}},
  })),{session});
  if(result.matchedCount!==changes.length)fail('A derived reference changed.');
 }
 for(const collection of order){
  const ids=plan.targets.filter(x=>x.collection===collection).map(x=>x.row._id);
  if(!ids.length)continue;
  const result=await database.collection(collection).deleteMany({_id:{$in:ids}},{session});
  if(result.deletedCount!==ids.length)fail('A reviewed record changed.');
 }
 await database.collection('testDataRegistry').deleteMany({_id:{$in:registry.map(r=>r._id)}},{session});
 const migrated=counts(revisions.filter(r=>r.after)),archivedAndRemoved=counts(revisions.filter(r=>!r.after));
 await database.collection('testDataCleanupJobs').insertOne({
  _id:id,state:'auth-pending',createdAt:new Date(),actorUid,counts:plan.summary.counts,detached:plan.summary.detach,migrated,archivedAndRemoved,
  integrityIssues:auditIntegrity(plan.next).unexplained,users,tokens,registry,archiveId:archive?._id||null,
  retainedHistory:plan.summary.retainedHistory,history:plan.retainedHistory.map(x=>({collection:x.collection,id:x.row._id,digest:testRecordDigest(x.row)})),
 },{session});
 await database.collection('superAdminAudit').insertOne({
  _id:'test-purge-'+id,action:'TEST_DATA_PURGED',actorUid,timestamp:new Date(),counts:plan.summary.counts,migrated,archivedAndRemoved,backupId:id,
 },{session});
 return id;
}

export async function finishTestPurge({database,auth,id}){
 const jobs=database.collection('testDataCleanupJobs'),job=await jobs.findOne({_id:id});
 if(!job)fail('Purge job not found.');
 if(job.state==='complete')return job.report;
 const live=await readDatabase(database,await cleanupCollectionNames(database));
 const integrityIssues=auditIntegrity(live).unexplained;
 const history=new Map((job.history||[]).map(x=>[rowKey(x.collection,x.id),x.digest]));
 for(const [collection,rows] of Object.entries(live)){
  if(!internal.has(collection)&&rows.some(row=>job.tokens.some(t=>bson(row).toLowerCase().includes(t))&&history.get(rowKey(collection,row._id))!==testRecordDigest(row)))fail('A target reference appeared after commit. Firebase removal is paused for review.');
 }
 if(integrityIssues>job.integrityIssues)fail('Integrity changed after commit. Firebase removal is paused for review.');
 // The operator migration authorizes disabling only accounts from its exact
 // journal, after Mongo commits and the operational dependency scan passes.
 const allowActive=!!job.archiveId;
 if(allowActive){
  const archive=(live.testDataHistoricalAttributions||[]).find(r=>r._id===job.archiveId);
  if(archive?.backupId!==id||archive.digest!==testRecordDigest(archive.records))fail('The migration history could not be verified.');
 }
 const authBefore=await verifiedTestAuth(auth,job.users,{allowActive});
 for(const user of authBefore.filter(u=>u.exists&&!u.disabled))await auth.updateUser(user.uid,{disabled:true});
 for(const user of await verifiedTestAuth(auth,job.users)){
  if(user.exists)try{await auth.deleteUser(user.uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
 }
 if((await verifiedTestAuth(auth,job.users)).some(x=>x.exists))fail('Firebase removal has not completed.');
 const report={id,removed:job.counts,detached:job.detached,migrated:job.migrated,archivedAndRemoved:job.archivedAndRemoved,
  retainedHistory:job.retainedHistory,firebaseRemaining:0,integrityIssues,backupId:id};
 await jobs.updateOne({_id:id},{$set:{state:'complete',report,completedAt:new Date()}});
 return report;
}

export function testDataCleanupRoutes(app,{database,client,auth,backupKey=process.env.TEST_DATA_BACKUP_KEY}){
 const base='/api/administration/test-data-cleanup';
 const ensureAdmin=async(actor,session)=>{
  const user=actor?.role==='super_admin'&&await database.collection('users').findOne({_id:actor.uid},{session});
  if(user?.role!=='super_admin'||isInactive(user))fail('Only Super Admin can manage test data.','permission-denied');
 };
 const usersFor=plan=>plan.targets.filter(x=>x.collection==='users').map(({row})=>({uid:row._id,email:row.email}));
 const jobs=database.collection('testDataCleanupJobs');
 const key=typeof backupKey==='string'&&/^[a-f0-9]{64}$/i.test(backupKey)?Buffer.from(backupKey,'hex'):null;
 app.get(base,async(req,res)=>{
  await ensureAdmin(req.actor);
  const plan=testDataPlan(await readDatabase(database,await cleanupCollectionNames(database))),users=usersFor(plan);
  let firebaseAccounts=0,authBlocked='';
  try{firebaseAccounts=(await verifiedTestAuth(auth,users)).filter(x=>x.exists).length;}catch{authBlocked='Firebase identity verification failed; check that each reviewed account is disabled and matches its UID and email.';}
  const unfinished=await jobs.findOne({state:'auth-pending'},{projection:{_id:1}});
  res.json({...plan.summary,firebaseAccounts,authBlocked,backupReady:!!key,pendingJob:unfinished?._id||null});
 });
 const finish=async(actor,id)=>{
  await ensureAdmin(actor);
  return finishTestPurge({database,auth,id});
 };
 app.post(base+'/purge',async(req,res)=>{
  await ensureAdmin(req.actor);
  const {fingerprint,confirmation}=req.body||{};
  if(!key)fail('Configure TEST_DATA_BACKUP_KEY before purging.');
  if(confirmation!=='PURGE TEST DATA'||typeof fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(fingerprint))fail('Review the scan and type PURGE TEST DATA.');
  if(await jobs.findOne({_id:fingerprint}))return res.json(await finish(req.actor,fingerprint));
  const collectionNames=await cleanupCollectionNames(database),session=client.startSession();
  try{await session.withTransaction(async()=>{
   await ensureAdmin(req.actor,session);
   if(await jobs.findOne({_id:fingerprint},{session}))return;
   if(await jobs.findOne({state:'auth-pending'},{session}))fail('Finish the pending Firebase cleanup first.');
   const snapshot=await readDatabase(database,collectionNames,session),plan=testDataPlan(snapshot);
   if(plan.summary.fingerprint!==fingerprint||plan.summary.blocked.length||!plan.targets.length)fail('The scan is stale, empty, or blocked. Scan again.');
   const users=usersFor(plan);await verifiedTestAuth(auth,users);
   await writeTestPurge({database,session,plan,key,actorUid:req.actor.uid,registry:(snapshot.testDataRegistry||[]).filter(r=>r.origin==='test')});
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});}finally{await session.endSession();}
  res.json(await finish(req.actor,fingerprint));
 });
 app.post(base+'/resume',async(req,res)=>{
  await ensureAdmin(req.actor);
  if(typeof req.body?.id!=='string'||!/^[a-f0-9]{64}$/.test(req.body.id))fail('Invalid purge job.');
  res.json(await finish(req.actor,req.body.id));
 });
}
