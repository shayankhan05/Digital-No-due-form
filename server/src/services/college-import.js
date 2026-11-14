import {newSubjectId} from './subject-semester.js';
import {semesterResolver} from './semester-context.js';
import {assertInputSemester,assertRecordSemester,semesterMatch} from './semester-context.js';
import {selectableFaculty} from '../../../js/faculty-eligibility.js';
import {assertSemester} from '../../../js/semester.js';
import {studentSectionCodes} from './section-master.js';
import {integritySnapshot,auditIntegrity} from './integrity-audit.js';
import {createHash,randomUUID} from 'node:crypto';
import {runImportRows} from './import-workers.js';
import {normalizeCollegeRow,defaultComponents} from '../../../js/college-csv.js';
import {departmentCode} from '../../../js/department.js';
import {isMentor,isFaculty} from '../../../js/capabilities.js';
import {isInactive} from './account-removal.js';
import {isManager} from './roles.js';
import {scopedAdminInput} from './department-master.js';
import {createProvisioner} from './provisioning.js';
import {previewStore,previewAuth} from './preview-store.js';
const jobSemester=job=>{if(job.semester!==undefined)return Number(job.semester);const semesters=[...new Set((job.rows||[]).map(r=>Number(r.semester)))];return semesters.length===1&&Number.isInteger(semesters[0])&&semesters[0]>=1&&semesters[0]<=8?semesters[0]:null;};
const hash=v=>createHash('sha256').update(v).digest('hex'),fail=(message,code='invalid-argument')=>{throw Object.assign(new Error(message),{code});};
export const subjectId=newSubjectId;
// Class identity is independent of the reusable subject master ID and teacher.
// Invalid academic rows must retain validation errors instead of sharing an empty key.
export function teachingAssignmentKey(row){
 const department=departmentCode(row.department),scheme=String(row.scheme??'').trim(),semester=Number(row.semester),section=String(row.section??'').trim().toUpperCase(),code=String(row.subjectCode??'').trim().toUpperCase();
 if(!department||!scheme||!Number.isInteger(semester)||semester<1||semester>8||!section||!code)return null;
 return 'academic:'+JSON.stringify([department,scheme,semester,section,code]);
}
export async function subjectRow(database,raw){
 const row={...raw,department:departmentCode(raw.department),scheme:String(raw.scheme||''),semester:assertSemester(raw.semester),subjectCode:String(raw.subjectCode||'').trim().toUpperCase(),subjectName:String(raw.subjectName||'').trim()},dep=await database.collection('departments').findOne({code:row.department,status:'active'}),scheme=await database.collection('schemes').findOne({code:row.scheme,status:'active'});
 if(!dep)fail('Unknown or inactive department.');if(raw.active!==undefined&&![true,false,'true','false'].includes(raw.active))fail('active must be true or false.');row.active=raw.active!==false&&raw.active!=='false';row.credits=raw.credits===undefined||raw.credits===''?null:Number(raw.credits);if(row.credits!==null&&(!Number.isFinite(row.credits)||row.credits<0||row.credits>30))fail('Credits must be 0–30.');if(!scheme||scheme.scope==='department'&&!scheme.departmentIds?.includes(dep._id)||dep.schemeIds?.length&&!dep.schemeIds.includes(scheme._id))fail('Invalid scheme for department.');assertSemester(row.semester);if(!/^[A-Z0-9_-]{1,40}$/.test(row.subjectCode)||!row.subjectName||row.subjectName.length>200)fail('Subject code and name are required.');row.departmentId=dep._id;row.id=subjectId(row);const candidates=await database.collection('subjects').find({department:row.department,scheme:row.scheme,code:row.subjectCode,...(dep.creationDigest?{departmentId:dep._id}:{})}).toArray();const resolve=semesterResolver(database),existing=[];for(const subject of candidates){const sem=await resolve('subjects',subject);if(sem===null)fail('Subject master has an ambiguous historical semester. Review it before importing.');if(sem===row.semester)existing.push(subject);}if(existing.some(s=>s.name!==row.subjectName||s.semester&&Number(s.semester)!==row.semester))fail('Subject already exists with different name/semester. Edit it explicitly.');if(existing.length>1)fail('Ambiguous subject master; resolve duplicates before import.');if(existing[0])row.id=existing[0]._id;else {
  // Another section worker can create this canonical master after the cohort read.
  // Reuse only that exact scoped subject; legacy/foreign ID collisions still fail.
  const concurrent=await database.collection('subjects').findOne({_id:row.id});
  if(concurrent&&(concurrent.departmentId!==dep._id||concurrent.department!==row.department||String(concurrent.scheme)!==row.scheme||concurrent.code!==row.subjectCode||concurrent.name!==row.subjectName||concurrent.semester&&Number(concurrent.semester)!==row.semester))fail('Subject ID belongs to a legacy/unscoped record; resolve explicitly before importing.');
 }return row;
}
async function assignmentRow(database,raw){
 assertSemester(raw.semester);
 const department=departmentCode(raw.department),semester=Number(raw.semester),section=String(raw.section||'').toUpperCase(),employeeId=String(raw.employeeId||'').toUpperCase(),code=String(raw.subjectCode||'').toUpperCase(),teachers=await database.collection('users').find({facultyId:employeeId}).collation({locale:'en',strength:2}).toArray();
 if(teachers.length!==1||!isFaculty(teachers[0])||isInactive(teachers[0])||departmentCode(teachers[0].department)!==department)fail('Missing, inactive or wrong-department teacher employee ID: '+employeeId);
 const academicDepartment=await database.collection('departments').findOne({code:department});const subjects=(await database.collection('subjects').find({...(academicDepartment?.creationDigest?{departmentId:academicDepartment._id}:{}),department,code,active:{$ne:false},...(raw.scheme?{scheme:String(raw.scheme)}:{})}).toArray()).filter(s=>!s.semester||Number(s.semester)===semester);const matched=[];const resolve=semesterResolver(database);for(const subject of subjects)if(await resolve('subjects',subject)===semester)matched.push(subject);if(matched.length!==1)fail('Missing or ambiguous semester subject: '+code);const subject=matched[0];
 return{department,scheme:subject.scheme,semester,section,subjectCode:code,subjectName:subject.name,teacherEmail:teachers[0].email,credits:subject.credits??null,components:raw.components||defaultComponents};
}
async function teachingRow(database,raw){
 const subject=await subjectRow(database,raw),employeeId=String(raw.employeeId||'').trim().toUpperCase(),teachers=await database.collection('users').find({facultyId:employeeId}).collation({locale:'en',strength:2}).toArray();
 if(!employeeId||teachers.length!==1||!isFaculty(teachers[0])||isInactive(teachers[0])||departmentCode(teachers[0].department)!==subject.department||teachers[0].departmentId&&teachers[0].departmentId!==subject.departmentId)fail('Missing, inactive or wrong-department faculty employee ID: '+employeeId);
 const dep=await database.collection('departments').findOne({_id:subject.departmentId}),policy=await database.collection('institutionPolicy').findOne({_id:'institution'})||{},section=String(raw.section||'').trim().toUpperCase();if(!studentSectionCodes(policy,dep,subject.semester).includes(section))fail('Choose a configured department section.');
 const existing=await database.collection('subjects').findOne({_id:subject.id});if(existing&&subject.credits!==null&&existing.credits!==undefined&&existing.credits!==null&&Number(existing.credits)!==subject.credits)fail('Subject credits differ from the existing master. Edit them explicitly.');
 const row={...subject,employeeId,section,teacherEmail:teachers[0].email,credits:subject.credits??existing?.credits??null,components:raw.components||defaultComponents};
 const scope=dep.creationDigest?{departmentId:subject.departmentId}:{$or:[{departmentId:subject.departmentId},{department:subject.department,departmentId:{$exists:false}}]},classes=await database.collection('offerings').find({...scope,scheme:subject.scheme,semester:{$in:[subject.semester,String(subject.semester)]},section,subjectCode:subject.subjectCode}).toArray(),canonical='class_'+hash([subject.department,subject.scheme,subject.semester,section,subject.subjectCode].join('|')).slice(0,32);
 if(classes.length>1)fail('Multiple records exist for this teaching assignment. Resolve them in Academic Setup before importing.');
 if(classes[0]&&classes[0]._id!==canonical){const old=classes[0];if(old.teacherId!==teachers[0]._id||JSON.stringify(old.components)!==JSON.stringify(row.components)||(old.active!==false)!==row.active)fail('Existing class teacher, assessments or status differ. Edit that class explicitly; import will not overwrite it.');row.existingClassId=old._id;}
 return row;
}
export function collegeImportRoutes(app,{database,client,store,auth,provisionerOptions,service}){
 const jobs=database.collection('bulkImportJobs'),check=actor=>{if(!isManager(actor.role)||isInactive(actor))fail('Administrator access required.','permission-denied');};
 app.get('/api/administration/integrity',async(req,res)=>{check(req.actor);res.json(auditIntegrity(await integritySnapshot(database),{departmentId:req.actor.managementDepartmentId}));});
 app.post('/api/college-import/preview',async(req,res)=>{
  check(req.actor);const {type,requestId}=req.body;if(!['students','teachers','teaching','subjects','facultyAssignments','offerings'].includes(type)||!Array.isArray(req.body.rows)||!req.body.rows.length||req.body.rows.length>2000||!/^[A-Za-z0-9_-]{8,100}$/.test(requestId||''))fail('Choose an import type and 1–2000 CSV rows.');
  const reconcile=type==='students'&&req.body.reconcileStudents===true;
  const studentOptions=reconcile?{keepPlacement:req.body.keepExistingPlacement===true}:null;
  const normalized=req.body.rows.map(row=>normalizeCollegeRow(row,type));
  const scoped=await scopedAdminInput(database,req.actor,{rows:normalized,previewSemesterRows:true});
  const preview=[],seen=new Map(),definitions=new Map();
  const reader=await previewStore(store,{studentReconciliation:reconcile});
  const studentIds=new Set(scoped.rows.flatMap(r=>[r.usn,r.auid].filter(Boolean).map(v=>String(v).toUpperCase())));
  const uids=reconcile?[req.actor.uid,...reader.snapshot.students.filter(s=>[s.usn,s.auid].some(v=>v&&studentIds.has(String(v).toUpperCase()))).map(s=>s._id)]:[];
  const readAuth=await previewAuth(auth,scoped.rows,uids);
  const validator=createProvisioner({...provisionerOptions,db:reader,auth:readAuth});
  for(let offset=0;offset<scoped.rows.length;offset+=100){let chunk;
   if(['subjects','facultyAssignments','teaching'].includes(type)){chunk={rows:[]};for(let i=offset;i<Math.min(offset+100,scoped.rows.length);i++)try{const row=type==='subjects'?await subjectRow(database,scoped.rows[i]):type==='teaching'?await teachingRow(database,scoped.rows[i]):await assignmentRow(database,scoped.rows[i]);if(type!=='subjects'){const result=await validator.dispatch(req.actor.uid,{action:'previewOfferings',rows:[row]});if(result.errors)fail(result.rows[0].error);}chunk.rows.push({index:i-offset,row,status:'VALID',warnings:[]});}catch(error){chunk.rows.push({index:i-offset,row:scoped.rows[i],status:'ERROR',error:error.message});}}
   else if(reconcile)chunk=await validator.previewStudentImport(req.actor.uid,scoped.rows.slice(offset,offset+100),studentOptions);
   else chunk=await validator.dispatch(req.actor.uid,{action:type==='students'?'previewAccounts':type==='teachers'?'previewTeachers':'previewOfferings',rows:scoped.rows.slice(offset,offset+100)});
   for(const entry of chunk.rows){entry.index+=offset;if(type!=='teachers')try{assertInputSemester(req.actor,scoped.rows[entry.index]);if(entry.existingUid)await assertRecordSemester(database,req.actor,'students',await database.collection('students').findOne({_id:entry.existingUid}));}catch(error){Object.assign(entry,{status:'ERROR',error:error.message});}const original=scoped.rows[entry.index],keys=type==='teaching'?(entry.status==='ERROR'?[]:[teachingAssignmentKey(entry.row)].filter(Boolean)):type==='students'?['email:'+String(original.collegeEmail).toLowerCase(),'identifier:'+String(original.usn).toUpperCase(),...(String(original.auid??'').trim()?['auid:'+String(original.auid).trim().toUpperCase()]:[])]:type==='teachers'?['email:'+String(original.collegeEmail).toLowerCase(),'identifier:'+String(original.employeeId).toUpperCase()]:['academic:'+JSON.stringify([original.department,original.scheme||'',Number(original.semester),String(original.section||'').trim().toUpperCase(),String(original.subjectCode||'').trim().toUpperCase()])];if(type==='teaching'&&entry.status!=='ERROR'){const key=JSON.stringify([entry.row.department,entry.row.scheme,entry.row.subjectCode]),spec=JSON.stringify([entry.row.subjectName,entry.row.semester,entry.row.credits]),old=definitions.get(key);if(old&&old.spec!==spec){Object.assign(entry,{status:'ERROR',error:'Conflicting subject details across CSV sections.'});Object.assign(preview[old.index],{status:'ERROR',error:entry.error});}else if(!old)definitions.set(key,{spec,index:entry.index});}if(reconcile&&entry.existingUid)keys.push('uid:'+entry.existingUid);for(const key of keys){if(seen.has(key)){Object.assign(entry,{status:'ERROR',error:key.startsWith('auid:')?'AUID already belongs to another student.':'Duplicate identity/academic row in CSV.',duplicate:true});Object.assign(preview[seen.get(key)],{status:'ERROR',error:entry.error,duplicate:true});}else seen.set(key,entry.index);}if(reconcile&&entry.duplicate){entry.classification='CONFLICT';for(const key of keys){const earlier=preview[seen.get(key)];if(earlier?.duplicate)earlier.classification='CONFLICT';}}if(type==='teaching'&&entry.error)entry.error=entry.error.replace(/offerings?/gi,'class');preview.push(entry);}
  }
  const errors=preview.filter(r=>r.status==='ERROR').length;
  const digest=hash(JSON.stringify([type,scoped.rows,req.actor.managementDepartmentId||'',req.actor.managementSemester||5,...(reconcile?[studentOptions]:[])]));
  const background=(type==='teaching'||reconcile)&&req.body.background===true;
  let id=hash(req.actor.uid+':'+requestId);
  if(!errors){
   if(background){
    const existing=await matchingImportJob(req.actor,type,digest);
    id=existing?._id||hash(type+':'+req.actor.uid+':'+digest+((await jobs.countDocuments({actorUid:req.actor.uid,type,digest,identitySuperseded:true}))?':identity-generation-'+await jobs.countDocuments({actorUid:req.actor.uid,type,digest,identitySuperseded:true}):''));
   }
   const old=await jobs.findOne({_id:id});
   if(old&&old.digest!==digest)fail('Import request ID belongs to another file.','already-exists');
   await jobs.updateOne({_id:id},{$setOnInsert:{actorUid:req.actor.uid,departmentId:req.actor.managementDepartmentId||null,semester:req.actor.managementSemester||5,type,digest,rows:reconcile?scoped.rows:preview.map(r=>r.row),...(reconcile?{studentOptions,studentPlans:preview.map(r=>({classification:r.classification,uid:r.existingUid,target:r.target}))}:{}),state:'validated',offset:0,results:[],createdAt:new Date()}},{upsert:true});
  }
  const studentSummary=reconcile?{
   new:preview.filter(r=>r.status!=='ERROR'&&r.classification==='NEW').length,
   existing:preview.filter(r=>r.status!=='ERROR'&&r.classification==='EXISTING').length,
   inactive:preview.filter(r=>r.status!=='ERROR'&&r.classification==='INACTIVE').length,
   conflicts:preview.filter(r=>['CONFLICT','AMBIGUOUS','DEMO_REPLACEMENT'].includes(r.classification)).length,
   mentorChanges:preview.filter(r=>r.status!=='ERROR'&&r.changes?.mentor).length,
   sectionChanges:preview.filter(r=>r.status!=='ERROR'&&r.changes?.section).length,
   deferred:preview.filter(r=>r.status!=='ERROR'&&r.changes?.academicDeferred).length,
  }:undefined;
  res.json({jobId:errors?null:id,rows:preview,total:preview.length,valid:preview.filter(r=>r.status==='VALID').length,warnings:preview.filter(r=>r.status==='WARNING').length,errors,studentSummary,targetSemester:req.actor.managementSemester||5,targetDepartmentId:req.actor.managementDepartmentId||null});
 });

 const leaseMs=180000;
 const release={$unset:{leaseUntil:'',leaseOwner:''}};
 const hasLease=job=>job.leaseUntil>Date.now();
 const priority=job=>hasLease(job)?3:job.state==='complete'?2:job.offset||job.results.length?1:0;
 async function matchingImportJob(actor,type,digest){
  const matches=await jobs.find({actorUid:actor.uid,departmentId:actor.managementDepartmentId||null,type,digest,...(type!=='teachers'?{semester:actor.managementSemester||5}:{}),identitySuperseded:{$ne:true}}).toArray();
  return matches.sort((a,b)=>priority(b)-priority(a)||b.results.length-a.results.length||b.createdAt-a.createdAt)[0];
 }
 async function ownedJob(actor,id){
  if(!/^[a-f0-9]{64}$/.test(id||''))fail('Validate and confirm this CSV first.');
  const job=await jobs.findOne({_id:id});
  if(job&&job.type!=='teachers'&&jobSemester(job)!==Number(actor.managementSemester??5))fail('Import belongs to another managing semester. Validate the CSV in the selected semester.','permission-denied');
  if(!job||job.actorUid!==actor.uid||(job.departmentId||null)!==(actor.managementDepartmentId||null))fail('Import belongs to another administrator/department.','permission-denied');
  if(job.identitySuperseded)fail('An identity in this import was replaced. Validate the CSV again.');
  if(job.type==='teaching'&&job.supersededBy){
   const completed=await jobs.findOne({_id:job.supersededBy,actorUid:actor.uid,departmentId:job.departmentId,type:job.type,digest:job.digest});
   if(completed)return completed;
  }
  return job;
 }
 function status(job){
  const result=summary(job);
  const state=hasLease(job)?(job.state==='queued'?'queued':'running')
   :job.state==='complete'?(result.errors?'failed':'completed')
   :job.state==='validated'&&!job.offset&&!job.results.length?'ready':'interrupted';
  return {...result,processed:job.results.length,status:state,safeToResume:state==='interrupted',retryRevision:job.retryRevision||0,requiresReactivation:!job.reactivationApproved&&!!job.studentPlans?.some(r=>r.classification==='INACTIVE')};
 }
 app.get('/api/college-import/jobs/latest',async(req,res)=>{
  check(req.actor);
  const type=req.query.type==='students'?'students':'teaching';
  const job=await jobs.findOne({
   actorUid:req.actor.uid,departmentId:req.actor.managementDepartmentId||null,type,semester:req.actor.managementSemester||5,...(type==='students'?{studentOptions:{$exists:true}}:{}),
   identitySuperseded:{$ne:true},supersededBy:{$exists:false},updatedAt:{$exists:true},
  },{sort:{updatedAt:-1}});
  res.set('Cache-Control','no-store').json(job?status(await matchingImportJob(req.actor,job.type,job.digest)||job):null);
 });
 app.get('/api/college-import/jobs/:id',async(req,res)=>{
  check(req.actor);
  const job=await ownedJob(req.actor,req.params.id);
  if(job.type!=='teaching'&&!job.studentOptions)fail('Job status is unavailable for this import.');
  res.set('Cache-Control','no-store').json(status(await matchingImportJob(req.actor,job.type,job.digest)||job));
 });

 async function runJob(job,actor,background){
  const id=job._id,owner=job.leaseOwner;
  const owned={_id:id,leaseOwner:owner};
  let leaseLost=false;
  const lease=()=>new Date(Date.now()+leaseMs);
  const guard=()=>{if(leaseLost)fail('Import lease changed.','already-exists');};
  const renew=async()=>{
   const result=await jobs.updateOne({...owned,leaseUntil:{$gt:new Date()}},{$set:{leaseUntil:lease()}});
   if(!result.matchedCount)leaseLost=true;
  };
  const heartbeat=setInterval(()=>renew().catch(()=>{leaseLost=true;}),30000);
  heartbeat.unref();
  try{
   if(background){
    const started=await jobs.updateOne({...owned,leaseUntil:{$gt:new Date()}},{$set:{state:'importing',updatedAt:new Date()}});
    if(!started.matchedCount)fail('Import lease changed.','already-exists');
   }
   do{
    const end=Math.min(job.offset+10,job.rows.length);
    const results=await runImportRows({
     start:job.offset,end,previous:job.results,
     checkpoint:async entry=>{
      guard();
      const saved=await jobs.updateOne({...owned,leaseUntil:{$gt:new Date()}},[{$set:{
       results:{$concatArrays:[{$filter:{input:{$ifNull:['$results',[]]},as:'row',cond:{$ne:['$$row.index',entry.index]}}},{$literal:[entry]}]},
       leaseUntil:{$literal:lease()},updatedAt:{$literal:new Date()},
      }}]);
      if(!saved.matchedCount)fail('Import lease changed.','already-exists');
     },
     process:async index=>{
      guard();
      const row=job.rows[index];if(job.type!=='teachers')assertInputSemester(actor,row);
      try{
       const existingUid=job.studentPlans?.[index]?.uid;if(existingUid)await assertRecordSemester(database,actor,'students',await database.collection('students').findOne({_id:existingUid}));
       await scopedAdminInput(database,actor,{row});
       let result;
       if(job.type==='subjects'){
        const checked=await subjectRow(database,row);
        const subjects=database.collection('subjects');
        const old=await subjects.findOne({_id:checked.id});
        await subjects.updateOne({_id:checked.id},{$setOnInsert:{code:checked.subjectCode,name:checked.subjectName,department:checked.department,departmentId:checked.departmentId,scheme:checked.scheme,semester:checked.semester,credits:checked.credits,active:checked.active,createdAt:new Date()}},{upsert:true});
        result={id:checked.id,accountCreated:!old};
       }else if(job.type==='teaching'){
        const checked=await teachingRow(database,row);
        if(checked.existingClassId){
         result={id:checked.existingClassId,offeringCreated:false,accountCreated:false,mappingErrors:[]};
         let cursor=null;
         if(checked.active)do{
          guard();
          const mapped=await service.dispatch(actor.uid,{action:'mapClass',...checked,cursor});
          result.mappingErrors.push(...mapped.results.filter(r=>r.error));
          cursor=mapped.nextCursor;
         }while(cursor);
        }else result=await service.dispatch(actor.uid,{action:'importOffering',row:checked});
       }else if(job.type==='facultyAssignments'){
        const employeeId=row.employeeId||await database.collection('users').findOne({email:row.teacherEmail}).then(u=>u?.facultyId);
        const checked=await assignmentRow(database,{...row,employeeId});
        result=await service.dispatch(actor.uid,{action:'importOffering',row:checked});
       }else if(job.studentOptions){
        result=await service.reconcileStudentImport(actor,row,job.studentOptions,job.studentPlans[index],'college_'+id.slice(0,40)+'_'+index);
       }else{
        const action=job.type==='students'?'provision':job.type==='teachers'?'importTeacher':'importOffering';
        result=await service.dispatch(actor.uid,{action,row,requestId:'college_'+id.slice(0,40)+'_'+index});
       }
       const {demoPassword,...safe}=result;
       if(result.uid&&job.type==='students'){
        const {syncOfficeSearchIndex}=await import('./office-search.js');
        await syncOfficeSearchIndex(store,result.uid);
       }
       return {index,name:row.name||row.subjectName,identifier:row.usn||row.employeeId||row.subjectCode,...safe,error:result.mappingErrors?.length?'Some academic mappings failed; inspect the report.':''};
      }catch(error){
       return {index,name:row.name||row.subjectName,identifier:row.usn||row.employeeId||row.subjectCode,error:error.message};
      }
     },
    });
    guard();
    const all=[...new Map([...job.results,...results].map(r=>[r.index,r])).values()].sort((a,b)=>a.index-b.index);
    const state=end===job.rows.length?'complete':background?'importing':'validated';
    if(state==='complete')await database.collection('superAdminAudit').updateOne({_id:'import_'+id+'_'+(job.retryRevision||0)},{$setOnInsert:{actorUid:actor.uid,actorRole:actor.role,departmentId:job.departmentId,action:job.type==='students'?'BULK_STUDENT_IMPORT':job.type==='teachers'?'BULK_FACULTY_IMPORT':job.type==='subjects'?'BULK_SUBJECT_IMPORT':'BULK_ASSIGNMENT_IMPORT',jobId:id,summary:job.rows.length+' rows; '+all.filter(r=>r.error).length+' errors.',timestamp:new Date()}},{upsert:true});
    const finished=await jobs.updateOne({...owned,leaseUntil:{$gt:new Date()}},{$set:{offset:end,results:all,state,updatedAt:new Date()},...(state==='importing'?{}:release)});
    if(!finished.matchedCount)fail('Import lease changed.','already-exists');
    job={...job,offset:end,results:all,state};
   }while(background&&job.state==='importing');
   return job;
  }catch(error){
   await jobs.updateOne(owned,{...release,$set:{state:background?'interrupted':'validated',updatedAt:new Date()}});
   throw error;
  }finally{clearInterval(heartbeat);}
 }

 app.post('/api/college-import/confirm',async(req,res)=>{
  check(req.actor);
  if(req.body.confirmation!==true)fail('Validate and confirm this CSV first.');
  let job=await ownedJob(req.actor,req.body.jobId);
  if(job.studentPlans?.some(r=>r.classification==='INACTIVE')&&!job.reactivationApproved&&req.body.reactivateStudents!==true)fail('Explicitly approve reactivating inactive student accounts.');
  const background=(job.type==='teaching'||job.studentOptions)&&req.body.background===true;
  if(background)job=await matchingImportJob(req.actor,job.type,job.digest)||job;
  const retry=job.state==='complete'&&req.body.retryFailed===true&&job.results.some(r=>r.error)
   &&(!background||req.body.retryRevision===(job.retryRevision||0));
  if(job.state==='complete'&&!retry)return res.json(background?status(job):summary(job));
  if(background&&hasLease(job))return res.json(status(job));
  const owner=randomUUID(),now=new Date();
  const locked=await jobs.findOneAndUpdate(
   {_id:job._id,state:job.state,...(retry?{retryRevision:job.retryRevision??{$exists:false}}:{}),$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lte:now}}]},
   {$set:{leaseUntil:new Date(now.getTime()+leaseMs),leaseOwner:owner,state:background?'queued':'importing',updatedAt:now,...(job.studentOptions&&req.body.reactivateStudents===true?{reactivationApproved:true}:{}),...(retry?{offset:0}:{})},...(retry?{$inc:{retryRevision:1}}:{})},
   {returnDocument:'after'},
  );
  if(!locked){
   if(background)return res.json(status(await ownedJob(req.actor,job._id)));
   fail('Import is already running. Wait for the current operation.','already-exists');
  }
  if(background){
   res.status(202).json(status(locked));
   void runJob(locked,req.actor,true).catch(error=>console.error('CSV import interrupted',locked._id,error.code||error.name));
   return;
  }
  res.json(summary(await runJob(locked,req.actor,false)));
 });
 app.get('/api/administration/mentors',async(req,res)=>{check(req.actor);const people=(await database.collection('users').find({role:{$in:['mentor','subject_faculty','hod']},...(req.actor.managementDepartmentId?{departmentId:req.actor.managementDepartmentId}:{})}).toArray()).filter(u=>isMentor(u)&&selectableFaculty(u)),counts=await database.collection('students').aggregate([{$match:{...await semesterMatch(database,req.actor,'students'),mentorId:{$in:people.map(u=>u._id)},accountStatus:{$nin:['inactive','deleted','deactivating','deleting','exited','exiting']}}},{$lookup:{from:'users',localField:'_id',foreignField:'_id',as:'profile'}},{$match:{'profile.0':{$exists:true}}},{$group:{_id:'$mentorId',count:{$sum:1}}}]).toArray();res.json({rows:people.map(u=>({uid:u._id,name:u.name,email:u.email,facultyId:u.facultyId,mentees:counts.find(c=>c._id===u._id)?.count||0}))});});
}
function summary(job){const errors=job.results.filter(r=>r.error).length;return{jobId:job._id,state:job.state,total:job.rows.length,processed:job.offset,created:job.results.filter(r=>!r.error&&(r.accountCreated||r.offeringCreated)).length,existing:job.results.filter(r=>!r.error&&!r.accountCreated&&!r.offeringCreated).length,errors,mentorMappings:job.results.filter(r=>r.mentorMapped&&!r.error).length,subjectsMapped:job.results.reduce((n,r)=>n+(r.subjectsMapped||0),0),results:job.results};}
