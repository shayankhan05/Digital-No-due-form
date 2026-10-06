import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesStudent,subjectItem,enrollmentPlan,migrateRequest} from '../functions/clearance.js';
import {approvalHTML} from '../js/student-updates.js';
import {stage1Change,resumeChange} from '../js/workflow-model.js';
const student={name:'Student',department:'ISE',scheme:2022,semester:5,section:'B',mentorId:'mentor'};
const base={id:'b1',teacherId:'sana',subjectCode:'BCS514',subjectName:'Agile Project Management',department:'ISE',scheme:'2022',semester:'5',section:' B ',active:true};
const teacher={name:'Sana Mir',email:'sana@example.test',role:'subject_faculty'};
function fixture(extra=[]) {
  const records={'students/s':student,'settings/workflow':{library:'lib',accounts:'acc',hodId:'hod',officeId:'office'},'users/sana':teacher,
    ...Object.fromEntries(['mentor','hod','office'].map(role=>[`users/${role}`,{role}])), 'users/lib':{role:'library'},'users/acc':{role:'accounts'},
    'offerings/b1':base,'offerings/b2':{...base,id:'b2',subjectCode:'BCS501',subjectName:'Software Engineering & Project Management'},
    ...Object.fromEntries(extra.map(o=>[`offerings/${o.id}`,o]))};
  const rows=['b1','b2',...extra.map(o=>o.id)].map(id=>({data:()=>({studentId:'s',offeringId:id,teacherId:'sana',active:true})}));
  const query={where(){return this;},async get(){return {docs:rows};}};
  return {doc:path=>({async get(){const data=records[path];return {id:path.split('/').at(-1),exists:!!data,data:()=>data};}}),collection:()=>query};
}
test('exact teacher identity is derived from the enrolled offering and user',async()=>{
  const p=await enrollmentPlan(fixture(),'s'),i=p.items.subject_b1;
  assert.equal(i.teacherUid,'sana');assert.equal(i.teacherName,teacher.name);assert.equal(i.teacherEmail,teacher.email);
  assert.equal(i.studentUid,'s');assert.equal(i.offeringId,'b1');assert.equal(i.section,'B');assert.equal(i.scheme,'2022');
});
for(const [title,change] of [['wrong section',{section:'A'}],['wrong semester',{semester:6}],['wrong department',{department:'ECE'}],['wrong scheme',{scheme:'2021'}],['inactive subject',{active:false}]]) {
  test(`${title} is excluded even with an active enrollment`,async()=>{
    const p=await enrollmentPlan(fixture([{...base,...change,id:'wrong'}]),'s');assert.equal(p.items.subject_wrong,undefined);
  });
}
test('same teacher teaching two subjects requires two separate offering approvals',async()=>{
  const p=await enrollmentPlan(fixture(),'s');assert.equal(Object.keys(p.items).length,4);assert.equal(p.items.subject_b1.teacherUid,p.items.subject_b2.teacherUid);
  let r={status:'pending_stage1',remaining:4,approvalStates:p.initialStates};
  for(const id of ['library','accounts','subject_b1'])r={...r,...stage1Change(r,id,'approved')};
  assert.equal(r.status,'pending_stage1');r={...r,...stage1Change(r,'subject_b2','approved')};assert.equal(r.status,'pending_mentor');
});
test('library and accounts required; physics and chemistry omitted',async()=>{
  const p=await enrollmentPlan(fixture(),'s');assert.ok(p.items.library);assert.ok(p.items.accounts);assert.equal(p.items.physics_lab,undefined);assert.equal(p.items.chemistry_lab,undefined);
});
test('context normalization supports department aliases, numeric fields and whitespace',()=>{
  assert.equal(matchesStudent(student,{...base,department:'Information Science & Engineering',scheme:' 2022 '}),true);
});
test('old lab and generic approvals retained as history without blocking progress',async()=>{
  const p=await enrollmentPlan(fixture(),'s'),oldItems={...p.items,physics_lab:{approverType:'physics_lab',approverId:'physics'},generic:{approverType:'subject_faculty',approverId:'unrelated'}};
  const states=Object.fromEntries(Object.keys(oldItems).map(id=>[id,id in p.items?'approved':'pending']));
  const r={status:'pending_stage1',approvalItems:oldItems,approvalStates:states,remaining:2};
  const m=migrateRequest(r,p);assert.equal(m.patch.remaining,0);assert.equal(m.patch.status,'pending_mentor');
  assert.deepEqual(m.patch.workflowHistory.approvalItems,oldItems);assert.equal(m.patch.approvalItems.generic,undefined);
});
test('legacy rejection and resubmission retain approved subjects and original reason',async()=>{
  const p=await enrollmentPlan(fixture(),'s'),states={subject_b1:'rejected',subject_b2:'approved',library:'approved',accounts:'approved'};
  const old={status:'rejected',approvalItems:p.items,approvalStates:states,lastEvent:{actorId:'sana',actorName:'Sana Mir',subjectCode:'BCS514',reason:'Assignment pending'}};
  const r={...old,...migrateRequest(old,p).patch};assert.match(approvalHTML(r),/Sana Mir/);assert.match(approvalHTML(r),/Agile Project Management/);assert.match(approvalHTML(r),/Assignment pending/);
  const resumed=resumeChange(r);assert.equal(resumed.approvalStates.subject_b2,'approved');assert.equal(resumed.approvalStates.subject_b1,'pending');
});
test('completed requests remain untouched and workflow migration is idempotent',async()=>{
  const p=await enrollmentPlan(fixture(),'s');assert.equal(migrateRequest({status:'issued'},p),null);
  assert.equal(migrateRequest({status:'cleared'},p),null);assert.equal(migrateRequest({workflowVersion:3,status:'pending_stage1'},p),null);
});
test('identity is one offering per student, never a teacher-wide generic approval',()=>{
  const i=subjectItem('s',student,base,teacher);assert.equal(i.approverId,i.teacherUid);assert.equal(i.subjectCode,'BCS514');assert.equal(i.department,'ISE');
});
