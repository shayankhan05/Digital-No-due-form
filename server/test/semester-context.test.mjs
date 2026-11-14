import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {connectDatabase} from '../src/db.js';
import {createApp} from '../src/app.js';
import {semesterResolver} from '../src/services/semester-context.js';
import {subjectRow} from '../src/services/college-import.js';
import request from 'supertest';
let memory,client,database,app,store;
let authMutations=0;
const auth={
 verifyIdToken:async uid=>({uid}),
 getUser:async uid=>{const user=await database.collection('users').findOne({_id:uid});if(!user)throw Object.assign(Error('Missing user'),{code:'auth/user-not-found'});return{uid,email:user.email,disabled:false,metadata:{creationTime:'2026-01-01',lastSignInTime:'2026-11-01'}};},
 getUsers:async identifiers=>{const users=[],notFound=[];for(const id of identifiers){const user=await database.collection('users').findOne(id.uid?{_id:id.uid}:{email:id.email});if(user)users.push({uid:user._id,email:user.email,disabled:false});else notFound.push(id);}return{users,notFound};},
 createUser:async()=>{authMutations++;throw Error('No Auth mutation expected');},
 updateUser:async()=>{authMutations++;throw Error('No Auth mutation expected');},
 deleteUser:async()=>{authMutations++;throw Error('No Auth mutation expected');},
};
const call=(actor,semester,path,body)=>{const req=request(app).post(path).set('Authorization','Bearer '+actor);if(['super','department-admin'].includes(actor))req.set('X-Department-Id','dept_ISE');if(semester!==null)req.set('X-Semester',String(semester));return req.send(body);};
const get=(actor,semester,path)=>{const req=request(app).get(path).set('Authorization','Bearer '+actor).set('X-Semester',String(semester));if(['super','department-admin'].includes(actor))req.set('X-Department-Id','dept_ISE');return req;};
const query=(actor,semester,path)=>call(actor,semester,'/api/data/query',{path,limit:100});
before(async()=>{
 memory=await MongoMemoryReplSet.create({replSet:{storageEngine:'wiredTiger'}});
 ({client,database}=await connectDatabase(memory.getUri('semester_scoping_audit')));
 ({app,store}=createApp({database,client,auth,demo:true,origins:['http://127.0.0.1:5064']}));
 await database.collection('departments').insertMany([
  {_id:'dept_ISE',code:'ISE',codeKey:'ise',name:'ISE',nameKey:'ise',status:'active',adminId:'department-admin',departmentAdminId:'department-admin',hodId:'head',sections:['A','B','C']},
  {_id:'dept_CSE',code:'CSE',codeKey:'cse',name:'CSE',nameKey:'cse',status:'active'},
 ]);
 await database.collection('schemes').insertOne({_id:'scheme_2022',code:'2022',codeKey:'2022',name:'2022',nameKey:'2022',status:'active',scope:'institution'});
 await database.collection('institutionPolicy').insertMany([
  {_id:'institution',allowedDomains:['college.test'],sections:['A','B','C']},
  {_id:'workflow',hodId:'head',officeId:'office',library:'library',accounts:'accounts',sports:'sports'},
 ]);
 await database.collection('departmentWorkflows').insertOne({_id:'dept_ISE',departmentId:'dept_ISE',hodId:'head',officeId:'office',library:'library',accounts:'accounts',sports:'sports'});
 for(const [uid,role]of [['super','super_admin'],['department-admin','admin'],['teacher','subject_faculty'],['head','hod'],['office','office'],['library','library'],['accounts','accounts'],['sports','sports']])
  await store.doc('users/'+uid).set({name:uid,email:uid+'@college.test',role,facultyId:uid==='teacher'?'ISE-FAC-001':uid,department:'ISE',departmentId:'dept_ISE',scope:['library','accounts','sports'].includes(role)?'institution':'department',accountStatus:'active',...(uid==='teacher'?{isMentor:true}:{})});
 for(const semester of [3,5,7]){
  const total=semester===5?265:1;
  for(let i=0;i<total;i++){
   const uid='student-'+semester+'-'+i,profile={uid,name:'Official Student '+semester+' '+i,role:'student',usn:'SEM'+semester+'STU'+String(i).padStart(4,'0'),auid:'SEM'+semester+'A'+i,email:uid+'@college.test',phone:'9876543210',semester,section:'A',scheme:'2022',department:'ISE',departmentId:'dept_ISE',mentorId:'teacher',teacherIds:['teacher'],offeringIds:['class-'+semester],accountStatus:'active'};
   await store.doc('users/'+uid).set(profile);await store.doc('students/'+uid).set(profile);
   await store.doc('enrollments/'+uid+'__class-'+semester).set({studentId:uid,offeringId:'class-'+semester,teacherId:'teacher',mentorId:'teacher',department:'ISE',departmentId:'dept_ISE',semester,section:'A',scheme:'2022',active:true});
  }
  await store.doc('subjects/subject-'+semester).set({name:'Semester '+semester+' subject',code:'OVERLAP',department:'ISE',departmentId:'dept_ISE',scheme:'2022',...(semester!==5?{semester}:{}),credits:3,active:true});
  await store.doc('offerings/class-'+semester).set({subjectId:'subject-'+semester,subjectCode:'OVERLAP',subjectName:'Semester '+semester+' subject',semester,section:'A',scheme:'2022',department:'ISE',departmentId:'dept_ISE',teacherId:'teacher',components:[{id:'ia1',label:'IA1',max:30}],active:true});
  await database.collection('noDueRequests').insertOne({_id:'request-'+semester,studentId:'student-'+semester+'-0',studentName:'Official Student '+semester+' 0',usn:'SEM'+semester+'STU0000',semester,departmentId:'dept_ISE',mentorId:'teacher',hodId:'head',officeId:'office',status:'pending_stage1',createdAt:new Date(),approvalItems:{subject:{approverId:'teacher',offeringId:'class-'+semester}},approvalStates:{subject:'pending'},approverIds:['teacher']});
 }
 await database.collection('marks').insertOne({_id:'student-5-0__class-5',studentId:'student-5-0',offeringId:'class-5',teacherId:'teacher',mentorId:'teacher',semester:5,scores:{ia1:29},updatedAt:new Date('2026-01-01')});
 await database.collection('approvals').insertOne({_id:'request-5/subject',__parent:'request-5',requestId:'request-5',studentId:'student-5-0',approverId:'teacher',status:'pending'});
 await database.collection('noDueRequests').insertOne({_id:'historical-request',studentId:'student-5-0',studentName:'Historic',semester:1,departmentId:'dept_ISE',status:'issued'});
});
after(async()=>{await client?.close();await memory?.stop();});

test('all semesters 1-8 isolate the 265-student verified cohort and directory in both admin roles',async()=>{
 for(const actor of ['super','department-admin'])for(let semester=1;semester<=8;semester++){
  const expected=semester===5?265:[3,7].includes(semester)?1:0;
  const result=await call(actor,semester,'/api/administration/directory',{role:'student',status:'active'});
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.total,expected);const setup=await get(actor,semester,'/api/administration/setup/dept_ISE');assert.equal(setup.status,200);assert.equal(setup.body.counts.students,expected);
  const listed=await query(actor,semester,'students');assert.equal(listed.status,200);assert.ok(listed.body.rows.every(r=>Number(r.data.semester)===semester));
 }
 const missing=await call('super',null,'/api/administration/directory',{role:'student',status:'active'});assert.equal(missing.status,400);
 assert.equal((await query('super',0,'students')).status,400);assert.equal((await query('super',9,'students')).status,400);
 const foreign=await request(app).post('/api/data/query').set('Authorization','Bearer department-admin').set('X-Semester','3').set('X-Department-Id','dept_CSE').send({path:'students'});assert.equal(foreign.status,403);
});
test('subjects, assignments, enrollments, marks and historical requests use their own semester',async()=>{
 for(const actor of ['super','department-admin'])for(const semester of [3,5,7]){
  const subjects=await query(actor,semester,'subjects');assert.deepEqual(subjects.body.rows.map(r=>r.id),['subject-'+semester]);
  const offerings=await query(actor,semester,'offerings');assert.deepEqual(offerings.body.rows.map(r=>r.id),['class-'+semester]);
  const enrollments=await query(actor,semester,'enrollments');assert.ok(enrollments.body.rows.every(r=>r.data.semester===semester));
  const marks=await query(actor,semester,'marks');assert.equal(marks.body.rows.length,semester===5?1:0);
  const monitor=await get(actor,semester,'/api/oversight/requests');assert.equal(monitor.status,200);assert.deepEqual(monitor.body.rows.map(r=>r.id),['request-'+semester]);
  const assigned=await get(actor,semester,'/api/administration/teaching-assignments?departmentId=dept_ISE');assert.equal(assigned.status,200,JSON.stringify(assigned.body));assert.deepEqual(assigned.body.offerings.map(r=>r.id),['class-'+semester]);
 }
 const historical=await get('super',1,'/api/oversight/requests');assert.equal(historical.body.rows[0].id,'historical-request');
 const child=await query('super',5,'noDueRequests/request-5/approvals');assert.equal(child.body.rows.length,1);
 assert.equal((await query('super',3,'noDueRequests/request-5/approvals')).status,403);
});
test('cross-semester direct reads, updates, marks and student/reset/replacement endpoints are blocked',async()=>{
 const mark=await database.collection('marks').findOne({});
 for(const [path,body]of [
  ['/api/data/read',{path:'students/student-5-0'}],
  ['/api/data/write',{operations:[{type:'update',path:'students/student-5-0',data:{name:'Wrong semester'}}]}],
  ['/api/data/write',{operations:[{type:'update',path:'offerings/class-5',data:{active:false}}]}],
  ['/api/data/write',{operations:[{type:'set',path:'marks/student-5-0__class-5',data:{scores:{ia1:0}}}]}],
  ['/api/data/write',{operations:[{type:'set',path:'students/student-5-0/clearance/plan',data:{semester:3,departmentId:'dept_ISE',valid:false}}]}],
  ['/api/data/write',{operations:[{type:'set',path:'assignments/spoofed-cross-semester',data:{semester:3,offeringId:'class-5',departmentId:'dept_ISE',title:'Blocked'}}]}],
  ['/api/students/workflow',{studentUid:'student-5-0'}],
  ['/api/oversight/requests/request-5/reset',{confirmation:true}],
  ['/api/student-replacements/preview',{uid:'student-5-0'}],
  ['/api/student-replacements/preview',{uid:'student-3-0',row:{semester:5}}],
 ])assert.equal((await call('super',3,path,body)).status,403,path);
 assert.deepEqual(await database.collection('marks').findOne({}),mark);
 assert.equal((await database.collection('students').findOne({_id:'student-5-0'})).name,'Official Student 5 0');
});
test('wrong-semester and mixed CSVs never produce a confirmable job; missing mentors remain blocked',async()=>{
 const row={name:'New student',usn:'SEM3NEW1',auid:'SEM3A999',collegeEmail:'new@college.test',phone:'9876543210',department:'ISE',scheme:'2022',semester:3,section:'A',mentorEmployeeId:'ISE-FAC-001'};
 const preview=(actor,rows)=>call(actor,3,'/api/college-import/preview',{type:'students',rows,reconcileStudents:true,requestId:crypto.randomUUID()});
 for(const actor of ['super','department-admin']){
  const wrong=await preview(actor,[{...row,semester:5}]);assert.equal(wrong.status,200,JSON.stringify(wrong.body));assert.equal(wrong.body.errors,1);assert.equal(wrong.body.jobId,null);assert.match(wrong.body.rows[0].error,/Managing Semester 3/);
  const mixed=await preview(actor,[row,{...row,usn:'SEM5NEW1',auid:'SEM5A999',collegeEmail:'new5@college.test',semester:5}]);assert.equal(mixed.body.errors,1);assert.equal(mixed.body.jobId,null);
  const missing=await preview(actor,[{...row,mentorEmployeeId:'MISSING'}]);assert.equal(missing.body.errors,1);assert.match(missing.body.rows[0].error,/mentor|facultyId/i);
  const safe=await preview(actor,[row]);assert.equal(safe.body.errors,0,JSON.stringify(safe.body));assert.equal(safe.body.targetSemester,3);
  const blocked=await call(actor,5,'/api/college-import/confirm',{jobId:safe.body.jobId,confirmation:true,background:true});assert.equal(blocked.status,403);
  assert.equal((await get(actor,5,'/api/college-import/jobs/'+safe.body.jobId)).status,403);
 }
 assert.equal(await database.collection('students').countDocuments(),267);assert.equal(authMutations,0);
});
test('Section A metadata and enabled sections are independent in Semesters 3 and 5',async()=>{
 const save=(semester,room)=>call('super',semester,'/api/administration/section-details',{section:'A',label:'Section A',room,classTeacherId:'teacher'});
 assert.equal((await save(3,'Room 301')).status,200);assert.equal((await save(5,'Room 501')).status,200);
 for(const semester of [3,5]){const result=await get('super',semester,'/api/administration/section/A');assert.equal(result.body.details.room,semester===3?'Room 301':'Room 501');assert.equal(result.body.currentStudents,semester===3?1:265);}
 const inactive=await call('super',3,'/api/administration/master',{kind:'sections',id:'section_B',code:'B',status:'inactive'});assert.equal(inactive.status,200,JSON.stringify(inactive.body));
 assert.equal((await get('super',3,'/api/administration/section/A?semester=')).status,200);
 const scoped=await call('super',3,'/api/administration/master',{kind:'sections',code:'SEM3ONLY',status:'active'});assert.equal(scoped.status,200);
 const catalog=await call('super',3,'/api/administration/master',{kind:'sections',code:'CATONLY',status:'active',catalogOnly:true});assert.equal(catalog.status,200);
 for(const semester of [3,5]){const assignments=await get('super',semester,'/api/administration/teaching-assignments?departmentId=dept_ISE');assert.equal(assignments.body.sections.includes('SEM3ONLY'),semester===3);}

 for(const semester of [3,5]){const masters=await get('super',semester,'/api/administration/masters');assert.equal(masters.body.sections.find(s=>s.code==='B').status,semester===3?'inactive':'active');}
});
test('one faculty/mentor account retains access across semesters while admin mentor counts are scoped',async()=>{
 const classes=await query('teacher',3,'offerings');assert.deepEqual(classes.body.rows.map(r=>r.id),['class-3','class-5','class-7']);
 const mentees=await get('teacher',3,'/api/academic/mentees');assert.equal(mentees.status,200);assert.equal(mentees.body.rows.length,30);
 for(const semester of [3,5,7]){const result=await get('super',semester,'/api/administration/mentors');assert.equal(result.body.rows.find(r=>r.uid==='teacher').mentees,semester===5?265:1);}
 const capabilities=await get('super',1,'/api/administration/faculty-capabilities');assert.equal(capabilities.body.rows.find(r=>r.uid==='teacher').assignedStudents,0);assert.equal(capabilities.body.rows.find(r=>r.uid==='teacher').totalAssignedStudents,267);
 assert.equal((await call('super',1,'/api/administration/mentor-capability',{uid:'teacher',isMentor:false})).status,400);
 assert.equal(await database.collection('users').countDocuments({facultyId:'ISE-FAC-001'}),1);assert.equal(authMutations,0);
});
test('subject codes can overlap across semesters without renaming legacy Semester 5 master',async()=>{
 const before=await database.collection('subjects').findOne({_id:'subject-5'});
 const checked=await subjectRow(database,{department:'ISE',scheme:'2022',semester:5,subjectCode:'OVERLAP',subjectName:before.name,credits:3});assert.equal(checked.id,'subject-5');
 const separate=await subjectRow(database,{department:'ISE',scheme:'2022',semester:1,subjectCode:'OVERLAP',subjectName:'Semester 1 subject',credits:3});assert.notEqual(separate.id,checked.id);
 assert.deepEqual(await database.collection('subjects').findOne({_id:'subject-5'}),before);
 const resolve=semesterResolver(database);assert.equal(await resolve('subjects',before),5);
 assert.equal(await resolve('clearancePlans',{_id:'unattributed-old-plan'}),null);
 assert.equal(await resolve('noDueRequests',{_id:'old-request',studentId:'student-5-0'}),null);
});


test('Chrome admin semester selector persists, refreshes cohorts and shows a complete safe CSV preview',async()=>{
 const {chromium}=await import('playwright'),{default:express}=await import('express'),{fileURLToPath}=await import('node:url');
 const backend=app.listen(0,'127.0.0.1');await new Promise(resolve=>backend.once('listening',resolve));
 const frontend=express().use(express.static(fileURLToPath(new URL('../..',import.meta.url)))).listen(5064,'127.0.0.1');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const actor of ['super','department-admin']){
   const context=await browser.newContext({viewport:{width:1366,height:900}}),profile=await database.collection('users').findOne({_id:actor});
   const errors=[];const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/js/firebase-config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const auth={currentUser:{uid:'+JSON.stringify(actor)+',getIdToken:async()=>'+JSON.stringify(actor)+'}};export const db={};export const functions={};export const isEmulator=false;'}));
   await context.route('**/js/api-config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const API_BASE_URL='+JSON.stringify('http://127.0.0.1:'+backend.address().port)+';'}));
   await context.route('**/js/auth.js',route=>route.fulfill({contentType:'text/javascript',body:'import {mountDepartmentContext} from "./department-management.js";export const wireLogout=()=>{};export async function requireAuth(){const p='+JSON.stringify({...profile,uid:actor})+';await mountDepartmentContext(p);document.body.classList.remove("auth-pending");return p;}'}));
   context.on('request',req=>assert.ok(!/onrender.com|googleapis.com|firebaseapp.com/.test(req.url()),'Isolated browser must never contact production'));
   const url='http://127.0.0.1:5064/'+(actor==='super'?'super-admin-dashboard.html':'admin-dashboard.html')+'#students';
   await page.goto(url);await page.locator('#managementSemester').waitFor();
   if(actor==='super'){await page.locator('#managementDepartment').selectOption('dept_ISE');await page.waitForLoadState('load');}
   await page.locator('#importFile').waitFor();assert.equal(await page.locator('#managementSemester').inputValue(),'5');
   const options=await page.locator('#managementSemester option').allTextContents();assert.deepEqual(options,['1st Semester','2nd Semester','3rd Semester','4th Semester','5th Semester','6th Semester','7th Semester','8th Semester']);
   await page.locator('#managementSemester').selectOption('3');await page.waitForLoadState('load');await page.locator('#importFile').waitFor();
   assert.equal(await page.locator('#managementSemester').inputValue(),'3');assert.match(await page.locator('#importTarget').innerText(),/Target Semester: 3/);
   if(actor==='super')await page.locator('body.workspace-ready').waitFor();
   if(await page.locator('#importType').isVisible())await page.locator('#importType').selectOption('students');else assert.equal(await page.locator('#importType').inputValue(),'students');
   const csv='usn,auid,name,college_email,phone,scheme,semester,section,mentor_employee_id\r\nSEM5NEWUI,SEM5AUI,Preview Only,preview.ui@college.test,9876543210,2022,5,A,ISE-FAC-001';
   await page.locator('#importFile').setInputFiles({name:'wrong-semester.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
   await page.locator('#previewBtn').click();await page.locator('#importPreview tbody tr').waitFor();
   assert.equal(await page.locator('#importPreview tbody td:nth-child(10)').innerText(),'ERROR');assert.match(await page.locator('#importPreview').innerText(),/Managing Semester 3/);assert.equal(await page.locator('#importBtn').isDisabled(),true);
   const columns=await page.locator('#importPreview th').allTextContents();assert.deepEqual(columns,['#','Name','USN','AUID','Email','Department','Semester','Section','Mentor','Status','Validation details']);
   await page.setViewportSize({width:390,height:844});const layout=await page.locator('#importPreview .table-scroll').evaluate(el=>({scrolls:el.scrollWidth>el.clientWidth,status:getComputedStyle(el.querySelector('td:nth-child(10)')).whiteSpace,details:getComputedStyle(el.querySelector('td:nth-child(11)')).whiteSpace}));assert.deepEqual(layout,{scrolls:true,status:'nowrap',details:'normal'});
   await page.setViewportSize({width:1366,height:900});await page.screenshot({path:fileURLToPath(new URL('../migration-output/semester-context-'+actor+'.png',import.meta.url)),fullPage:true});
   assert.deepEqual(errors,[]);await context.close();
  }
 }finally{await browser.close();await new Promise(resolve=>backend.close(resolve));await new Promise(resolve=>frontend.close(resolve));}
 assert.equal(authMutations,0);
});

