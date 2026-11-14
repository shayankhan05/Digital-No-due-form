import {assertInputSemester,assertRecordSemester,semesterMatch} from './semester-context.js';
import {createHash,randomUUID} from 'node:crypto';
import {EJSON} from 'bson';
import {isFaculty} from '../../../js/capabilities.js';
import {selectableFaculty} from '../../../js/faculty-eligibility.js';
import {departmentCode} from '../../../js/department.js';
import {assertSemester} from '../../../js/semester.js';
import {defaultComponents} from '../../../js/college-csv.js';
import {studentSectionCodes} from './section-master.js';
import {departmentOf} from './department-master.js';
import {isInactive} from './account-removal.js';
import {DocumentStore} from './document-store.js';
import {createProvisioner} from './provisioning.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,code='invalid-argument')=>{throw Object.assign(Error(message),{code});};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const eligible=user=>isFaculty(user)&&selectableFaculty(user);
const terminal=['issued','cancelled','exited'];
const facultyView=u=>({id:u._id,name:u.name,email:u.email,facultyId:u.facultyId,active:!isInactive(u)});
const classScope=dep=>dep.creationDigest?{departmentId:dep._id}:{$or:[{departmentId:dep._id},{departmentId:{$exists:false},department:dep.code}]};
const classId=(dep,scheme,semester,section,code)=>'class_'+hash([dep.code,scheme,semester,section,code].join('|')).slice(0,32);
const unique=values=>[...new Set(values.filter(Boolean))];
const read=(db,name,filter,session)=>db.collection(name).find(filter,{session}).sort({_id:1}).toArray();
async function context(db,actor,id,session){
 const user=await db.collection('users').findOne({_id:actor.uid},{session});
 if(!user||isInactive(user)||!['admin','super_admin'].includes(user.role))fail('Administrator access required.','permission-denied');
 if(!identifier(id))fail('Choose a department.');
 if(user.role==='admin'&&(await departmentOf(db,'users',{...user,scope:'department'}))!==id)fail('You can only manage your own department.','permission-denied');
 if(actor.managementDepartmentId&&actor.managementDepartmentId!==id)fail('Switch to this department before managing its assignments.','permission-denied');
 const dep=await db.collection('departments').findOne({_id:id},{session});
 if(!dep||dep.status!=='active')fail('Choose an active department.');
 return {dep,user};
}
async function catalog(db,dep,session,actor){
 const scope=classScope(dep),subjects=await read(db,'subjects',{...scope,...await semesterMatch(db,actor,'subjects'),active:{$ne:false}},session);
 const schemes=(await read(db,'schemes',{status:'active'},session)).filter(s=>(s.scope==='institution'||s.departmentIds?.includes(dep._id))&&(!dep.schemeIds?.length||dep.schemeIds.includes(s._id)));
 const allowed=new Set(schemes.map(s=>s.code));
 const faculty=(await read(db,'users',scope,session)).filter(u=>eligible(u)&&departmentCode(u.department)===dep.code);
 const policy=await db.collection('institutionPolicy').findOne({_id:'institution'},{session});
 return {subjects:subjects.filter(s=>allowed.has(String(s.scheme))),faculty,sections:studentSectionCodes(policy||{},dep,actor.managementSemester)};
}
const itemReference=(field,id)=>({$expr:{$in:[id,{$map:{input:{$objectToArray:{$ifNull:['$'+field,{}]}},as:'item',in:'$$item.v.offeringId'}}]}});
function itemFor(items,offering){
 const found=Object.entries(items||{}).filter(([k,v])=>k==='subject_'+offering._id||v?.offeringId===offering._id);
 if(found.length>1)fail('This record has multiple approvals for the same class. Review its mapping first.');
 return found[0];
}
function moved(item,offering,teacher){
 if(item.offeringId!==offering._id||item.approverId!==offering.teacherId||item.teacherUid&&item.teacherUid!==offering.teacherId)fail('A clearance item no longer matches the current teacher. Review it first.');
 const identity=item.subjectIdentity?.split('|');
 if(identity){if(identity[1]!==offering.teacherId)fail('A clearance item has an inconsistent subject identity.');identity[1]=teacher._id;}
 return {...item,approverId:teacher._id,teacherUid:teacher._id,teacherName:teacher.name||'',teacherEmail:teacher.email||'',...(identity?{subjectIdentity:identity.join('|')}:{})};
}
function approvers(before,after,ids){
 const previouslyAssigned=new Set(Object.values(before||{}).map(i=>i.approverId));
 return unique([...ids.filter(id=>!previouslyAssigned.has(id)),...Object.values(after).map(i=>i.approverId)]);
}
async function plan(db,actor,input,session){
 const {dep,user}=await context(db,actor,input.departmentId,session),scope=classScope(dep);
 const operation=input.operation;
 if(!['add','edit','deactivate','remove','subject-deactivate','subject-remove'].includes(operation))fail('Choose a supported assignment action.');
 if(operation.startsWith('subject-')){
  const subject=await db.collection('subjects').findOne({_id:identifier(input.subjectId)?input.subjectId:null,...scope},{session});
  if(!subject||departmentCode(subject.department)!==dep.code)fail('Subject not found in this department.','permission-denied');
  await assertRecordSemester(db,actor,'subjects',subject);
  const linked=await read(db,'offerings',{$or:[{subjectId:subject._id},{department:dep.code,scheme:subject.scheme,subjectCode:subject.code}]},session);
  const active=linked.filter(o=>o.active!==false).length;
  const history=await references(db,session,subject._id,subject);
  const blocked=operation==='subject-remove'&&(linked.length||history)?'This subject is used by '+active+' active offering(s), '+linked.length+' total offering(s), and '+history+' protected reference(s). Deactivate the subject instead.':'';
  const fingerprint=hash(EJSON.stringify({operation,subject,linked,history},{relaxed:false}));
  return {dep,user,subject,summary:{operation,fingerprint,blocked,linked:linked.length,activeOfferings:active,history,previous:{code:subject.code,name:subject.name,scheme:subject.scheme}}};
 }
 const old=operation==='add'?null:await db.collection('offerings').findOne({_id:identifier(input.offeringId)?input.offeringId:null,...scope},{session});
 if(operation!=='add'&&!old)fail('Assignment not found in this department.','permission-denied');
 if(old)await assertRecordSemester(db,actor,'offerings',old);
 if(old&&departmentCode(old.department)!==dep.code)fail('Assignment department does not match.','permission-denied');
 if(operation==='deactivate'&&old.active===false)fail('This assignment is already inactive.');
 let teacher,subject,next,relocate=false;
 if(['remove','deactivate'].includes(operation))next={...old,active:false};
 else{
  const options=await catalog(db,dep,session,actor),semester=assertSemester(input.semester),section=input.section;assertInputSemester(actor,input);
  subject=options.subjects.find(s=>s._id===input.subjectId);
  teacher=options.faculty.find(f=>f._id===input.teacherId);
  if(!subject||input.scheme!==undefined&&String(subject.scheme)!==input.scheme||!teacher||typeof section!=='string'||!options.sections.includes(section))fail('Choose an active subject, section, and eligible teacher in this department.');
  if(subject.semester!=null&&Number(subject.semester)!==semester)fail('Choose the semester configured for this subject.');
  const related=await read(db,'offerings',{...scope,subjectCode:subject.code,scheme:subject.scheme},session);
  if(subject.semester==null&&related.some(o=>Number(o.semester)!==semester))fail('Choose the semester already used for this subject.');
  if(related.some(o=>o._id!==old?._id&&Number(o.semester)===semester&&o.section===section))fail('An assignment already exists for this subject, scheme, semester and section. Edit that assignment.');
  const canonical=classId(dep,subject.scheme,semester,section,subject.code);
  relocate=!!old&&(old.subjectId!==subject._id||String(old.scheme)!==String(subject.scheme)||Number(old.semester)!==semester||old.section!==section);
  const id=old&&!relocate?old._id:canonical;
  if(id!==old?._id&&await db.collection('offerings').findOne({_id:id},{session}))fail('The destination class ID is already in use.');
  const components=old?.components??defaultComponents;
  next=old&&!relocate?{...old,teacherId:teacher._id}:{...(old||{}),_id:id,department:dep.code,departmentId:dep._id,subjectId:subject._id,subjectCode:subject.code,subjectName:subject.name,scheme:subject.scheme,semester,section,teacherId:teacher._id,credits:subject.credits??null,components,componentIds:old?.componentIds??components.map(c=>c.id),active:old?old.active!==false:true};
 }
 if(operation==='edit'&&typeof input.active==='boolean')next.active=input.active;
 const changedTeacher=!!old&&!['remove','deactivate'].includes(operation)&&old.teacherId!==next.teacherId;
 if(operation==='edit'&&!relocate&&!changedTeacher&&(old.active!==false)===next.active)fail('Choose a change to review.');
 let blocked='',history=0;
 const dependents={enrollments:[],marks:[],assignments:[],requests:[],approvals:[],plans:[],students:[],notifications:[]},moves=[];
 if(old){
  for(const name of ['enrollments','marks','assignments','approvals','notifications'])dependents[name]=await read(db,name,{offeringId:old._id},session);
  dependents.requests=await read(db,'noDueRequests',{$or:[itemReference('approvalItems',old._id),{['approvalItems.subject_'+old._id]:{$exists:true}}]},session);
  dependents.plans=await read(db,'clearancePlans',{$or:[itemReference('items',old._id),{['items.subject_'+old._id]:{$exists:true}}]},session);
  const studentIds=unique(dependents.enrollments.map(e=>e.studentId));
  dependents.students=await read(db,'students',{$or:[{_id:{$in:studentIds}},{offeringIds:old._id}]},session);
  if(operation==='remove'||relocate){
   history=await references(db,session,old._id);
   if(history||Object.values(dependents).some(list=>list.length))blocked='This class has protected dependencies. Keep it or review deactivation instead.';
  }
  if(old.active!==false&&next.active===false&&dependents.requests.some(r=>!terminal.includes(r.status)))blocked='Resolve active clearance requests before deactivating this offering.';
  if(changedTeacher){
   if(dependents.enrollments.some(e=>e.active===true&&e.teacherId!==old.teacherId))fail('An active enrollment has an inconsistent teacher. Repair its mapping first.');
   if(dependents.marks.some(m=>!dependents.enrollments.some(e=>e._id===m._id&&e.studentId===m.studentId)))fail('Marks are not linked to a matching enrollment. Repair the roster first.');
   if(dependents.students.some(s=>departmentCode(s.department)!==dep.code||s.departmentId&&s.departmentId!==dep._id)||studentIds.some(id=>!dependents.students.some(s=>s._id===id)))fail('An enrollment points outside this department or to a missing student.');
   for(const request of dependents.requests){
    const entry=itemFor(request.approvalItems,old);
    if(!entry||terminal.includes(request.status))continue;
    const [k,item]=entry,state=request.effectiveOverrides?.[k]?.decision??request.approvalStates?.[k];
    if(state==='rejected')fail('An active rejected approval must be resolved before changing this teacher.');
    if(state==='approved')continue;
    if(state!=='pending'||request.status!=='pending_stage1'||request.effectiveOverrides?.[k]||!dependents.enrollments.some(e=>e.studentId===request.studentId&&e.active===true))fail('An active clearance request requires separate review.');
    if(dependents.notifications.some(n=>n.requestId===request._id&&n.approverId===old.teacherId&&n.type==='approval_ready'&&!n.archived))fail('A pending teacher notification requires separate review.');
    const rows=dependents.approvals.filter(a=>a.requestId===request._id||a.__parent===request._id);
    if(rows.length!==1||rows[0].status!=='pending'||rows[0].actedAt||rows[0].actedBy)fail('A pending approval does not match its stored record.');
    const items={...request.approvalItems,[k]:moved(item,old,teacher)};
    moves.push({request,approval:rows[0],items,approverIds:approvers(request.approvalItems,items,request.approverIds||[]),approvalItem:moved(rows[0],old,teacher)});
   }
  }
 }
 const previousTeacher=old?await db.collection('users').findOne({_id:old.teacherId},{session}):null;
 const cohort=operation==='add'||next.active&&(relocate||old?.active===false)?await read(db,'students',{...scope,scheme:next.scheme,semester:{$in:[next.semester,String(next.semester)]},section:next.section},session):[];
 const affected=unique(dependents.enrollments.map(e=>e.studentId));
 const roster=changedTeacher?await read(db,'enrollments',{studentId:{$in:affected},active:true},session):[];
 const fingerprint=hash(EJSON.stringify({old,next,teacher:teacher&&facultyView(teacher),dependents,cohort,roster,history,blocked},{relaxed:false}));
 const summary={operation,blocked,history,assessments:old?.components?.length||0,active:next.active,previous:old&&{code:old.subjectCode,name:old.subjectName,semester:old.semester,section:old.section,teacher:previousTeacher?.name||'Unassigned'},next:{code:next.subjectCode,name:next.subjectName,semester:next.semester,section:next.section,teacher:teacher?.name||previousTeacher?.name||'Unassigned'},enrollments:dependents.enrollments.length,marks:dependents.marks.length,pending:operation==='edit'?moves.length:dependents.approvals.filter(a=>a.status==='pending'&&dependents.requests.some(r=>r._id===a.requestId&&!terminal.includes(r.status))).length,completed:dependents.approvals.filter(a=>a.status!=='pending').length,matchingStudents:cohort.filter(s=>!isInactive(s)).length,fingerprint};
 return {dep,user,old,next,teacher,relocate,changedTeacher,dependents,moves,roster,affected,summary};
}

async function references(db,session,id,subject){
 const legacy=value=>value&&typeof value==='object'&&!(value instanceof Date)&&(
  subject&&!value.subjectId&&value.subjectCode===subject.code&&
  (!value.scheme||String(value.scheme)===String(subject.scheme))&&
  (!value.department||departmentCode(value.department)===departmentCode(subject.department))||
  Object.values(value).some(legacy));
 let count=0;
 for(const name of ['students','assignments','enrollments','marks','approvals','notifications','noDueRequests','clearancePlans','workflowOverrides','presentationWorkflowArchives','hallTickets']){
  for await(const row of db.collection(name).find({},{session})){
   const text=EJSON.stringify(row);
   if(text.includes(id)||subject&&legacy(row))count++;
  }
 }
 return count;
}

export function teachingAssignmentRoutes(app,{database,client,auth,provisionerOptions}){
 const path='/api/administration/teaching-assignments';
 app.get(path,async(req,res)=>{
  const {dep}=await context(database,req.actor,req.query.departmentId),scope=classScope(dep);
  const options=await catalog(database,dep,undefined,req.actor),offerings=await read(database,'offerings',{...scope,...await semesterMatch(database,req.actor,'offerings')});
  const masters=await read(database,'subjects',{...scope,...await semesterMatch(database,req.actor,'subjects')});
  const staff=await read(database,'users',scope),staffById=new Map(staff.map(u=>[u._id,u]));
  const stats=await database.collection('enrollments').aggregate([{$match:{active:true,offeringId:{$in:offerings.map(o=>o._id)}}},{$group:{_id:'$offeringId',count:{$sum:1}}}]).toArray(),counts=new Map(stats.map(s=>[s._id,s.count]));
  res.json({masters:masters.map(s=>({id:s._id,code:s.code,name:s.name,scheme:s.scheme,semester:s.semester,active:s.active!==false,activeOfferings:offerings.filter(o=>o.subjectId===s._id&&o.active!==false).length})),faculty:options.faculty.map(facultyView),subjects:options.subjects.map(s=>({id:s._id,code:s.code,name:s.name,scheme:s.scheme,semester:s.semester})),sections:options.sections,offerings:offerings.map(o=>({id:o._id,subjectId:o.subjectId,code:o.subjectCode,name:o.subjectName,semester:o.semester,section:o.section,scheme:o.scheme,teacherId:o.teacherId,teacher:staffById.has(o.teacherId)?facultyView(staffById.get(o.teacherId)):null,enrolled:counts.get(o._id)||0,active:o.active!==false,components:o.components?.length||0})),students:await database.collection('students').countDocuments({...scope,...await semesterMatch(database,req.actor,'students'),accountStatus:{$nin:['inactive','exited','deleting','deleted','exiting','deactivating']}})});
 });
 app.post(path+'/preview',async(req,res)=>{
  const session=client.startSession();try{let reviewed;await session.withTransaction(async()=>{reviewed=await plan(database,req.actor,req.body,session);},{readConcern:{level:'snapshot'}});res.json(reviewed.summary);}finally{await session.endSession();}
 });
 app.post(path+'/apply',async(req,res)=>{
  if(req.body.confirmation!==true||typeof req.body.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(req.body.fingerprint))fail('Review and confirm the assignment first.');
  const session=client.startSession();try{
   let result;await session.withTransaction(async()=>{
    const p=await plan(database,req.actor,req.body,session),{old,next,teacher,dep,dependents,moves,roster,affected,summary}=p;
    if(summary.fingerprint!==req.body.fingerprint)fail('The assignment or its dependencies changed. Review again.','already-exists');
    if(summary.blocked)fail(summary.blocked);
    if(moves?.length&&req.body.movePending!==true)fail('Confirm that the pending approvals should move to the new teacher.');
    const opts={session},table=n=>database.collection(n);
    await table('departments').updateOne({_id:dep._id},{$inc:{teachingAssignmentRevision:1}},opts);
    if(p.subject){
     if(summary.operation==='subject-remove')await table('subjects').deleteOne({_id:p.subject._id},opts);
     else await table('subjects').updateOne({_id:p.subject._id},{$set:{active:false,updatedAt:new Date()}},opts);
     await table('superAdminAudit').insertOne({_id:randomUUID(),action:summary.operation==='subject-remove'?'SUBJECT_MASTER_REMOVED':'SUBJECT_MASTER_DEACTIVATED',actorUid:req.actor.uid,actorId:req.actor.uid,actorRole:p.user.role,departmentId:dep._id,targets:[p.subject._id],summary:p.subject.code+' — '+p.subject.name,timestamp:new Date()},opts);
     result={id:p.subject._id};return;
    }
    if(teacher)await table('users').updateOne({_id:teacher._id},{$inc:{accountMappingRevision:1}},opts);
    if(old&&old.teacherId!==teacher?._id)await table('users').updateOne({_id:old.teacherId},{$inc:{accountMappingRevision:1}},opts);
    if(summary.operation==='remove')await table('offerings').deleteOne({_id:old._id},opts);
    else if(!old||p.relocate){if(old)await table('offerings').deleteOne({_id:old._id},opts);await table('offerings').insertOne({...next,updatedAt:new Date()},opts);}
    else{const {_id,...patch}=next;await table('offerings').updateOne({_id},{$set:{...patch,updatedAt:new Date()}},opts);}
    if(p.changedTeacher){
     const setTeacher={teacherId:next.teacherId};
     await table('enrollments').updateMany({_id:{$in:dependents.enrollments.filter(e=>e.active===true).map(e=>e._id)}},{$set:setTeacher},opts);
     const currentEnrollments=new Set(dependents.enrollments.filter(e=>e.active===true).map(e=>e._id));
     await table('marks').updateMany({_id:{$in:dependents.marks.filter(m=>currentEnrollments.has(m._id)).map(m=>m._id)}},{$set:setTeacher},opts);
     for(const student of dependents.students)if(affected.includes(student._id)){
      const active=roster.filter(e=>e.studentId===student._id);
      const oldTeachers=new Set(active.map(e=>e.teacherId));
      const teacherIds=unique([...(student.teacherIds||[]).filter(id=>!oldTeachers.has(id)&&id!==old.teacherId),...active.map(e=>e.offeringId===old._id?next.teacherId:e.teacherId)]);
      await table('students').updateOne({_id:student._id},{$set:{teacherIds}},opts);
     }
     for(const record of dependents.plans){
      const entry=itemFor(record.items,old);if(!entry)continue;
      const [key,item]=entry,items={...record.items,[key]:moved(item,old,teacher)};
      await table('clearancePlans').updateOne({_id:record._id},{$set:{items,approverIds:approvers(record.items,items,record.approverIds||[])}},opts);
     }
     for(const m of moves){
      await table('noDueRequests').updateOne({_id:m.request._id},{$set:{approvalItems:m.items,approverIds:m.approverIds}},opts);
      const {_id,...fields}=m.approvalItem;await table('approvals').updateOne({_id},{$set:fields},opts);
     }
    }
    if((!old||p.relocate||old.active===false)&&next.active){
     const service=createProvisioner({...provisionerOptions,auth,db:new DocumentStore(database,client,session)});
     let cursor=null;do{const mapped=await service.dispatch(req.actor.uid,{action:'mapClass',department:dep.code,scheme:next.scheme,semester:next.semester,section:next.section,cursor});if(mapped.results.some(r=>r.error))fail('Could not safely map the class: '+mapped.results.find(r=>r.error).error);cursor=mapped.nextCursor;}while(cursor);
    }
    await table('superAdminAudit').insertOne({_id:randomUUID(),action:'TEACHING_ASSIGNMENT_'+(summary.operation==='add'?'ADDED':summary.operation==='remove'?'REMOVED':summary.operation==='deactivate'||old?.active!==false&&next.active===false?'DEACTIVATED':p.changedTeacher&&!p.relocate?'REASSIGNED':'EDITED'),actorUid:req.actor.uid,actorId:req.actor.uid,actorRole:p.user.role,departmentId:dep._id,targets:unique([old?._id,next._id]),summary:next.subjectCode+' / Semester '+next.semester+' / Section '+next.section,previous:summary.previous,next:summary.next,previousTeacherId:old?.teacherId??null,newTeacherId:next.teacherId,pendingRequests:moves.map(m=>m.request._id),timestamp:new Date()},opts);
    result={id:next._id,pendingMoved:moves.length};
   },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});res.json(result);
  }finally{await session.endSession();}
 });
}
