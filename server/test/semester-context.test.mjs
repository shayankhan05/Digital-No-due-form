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



test('section saves omit capacity, retain legacy capacity and keep class teachers optional within the department',async()=>{
 const people=[
  {_id:'section-peer',name:'Active department colleague',facultyId:'ISE-PEER',role:'subject_faculty',department:'ISE',departmentId:'dept_ISE'},
  {_id:'section-inactive',name:'Inactive colleague',facultyId:'ISE-INACTIVE',role:'subject_faculty',department:'ISE',departmentId:'dept_ISE',accountStatus:'inactive'},
  {_id:'section-disabled',name:'Disabled colleague',facultyId:'ISE-DISABLED',role:'subject_faculty',department:'ISE',departmentId:'dept_ISE',authDisabled:true},
  {_id:'section-hidden',name:'Unavailable colleague',facultyId:'ISE-HIDDEN',role:'subject_faculty',department:'ISE',departmentId:'dept_ISE',configurationSelectable:false},
  {_id:'section-foreign',name:'Foreign colleague',facultyId:'CSE-PEER',role:'subject_faculty',department:'CSE',departmentId:'dept_CSE'},
 ];
 for(const person of people){const {_id,...data}=person;await store.doc('users/'+_id).set({...data,email:_id+'@college.test'});}
 const protectedNames=['students','subjects','offerings','enrollments','marks','noDueRequests','approvals'],before={};for(const name of protectedNames)before[name]=await database.collection(name).find({}).sort({_id:1}).toArray();
 const facultyCount=await database.collection('users').countDocuments();
 for(const [actor,code]of [['super','SCT'],['department-admin','DCT']]){
  const added=await call(actor,5,'/api/administration/master',{kind:'sections',code,status:'active'});assert.equal(added.status,200,JSON.stringify(added.body));
  const save=body=>call(actor,5,'/api/administration/section-details',{section:code,label:code,...body});
  assert.equal((await save({room:'No teacher required'})).status,200);
  const fresh=await database.collection('sectionDetails').findOne({departmentId:'dept_ISE',semester:5,section:code});assert.equal(fresh.classTeacherId,null);assert.ok(!Object.hasOwn(fresh,'maximumCapacity'));
  await database.collection('sectionDetails').updateOne({_id:fresh._id},{$set:{maximumCapacity:73}});
  assert.equal((await save({room:'Changed room',maximumCapacity:-100})).status,200);
  const preserved=await database.collection('sectionDetails').findOne({_id:fresh._id});assert.equal(preserved.maximumCapacity,73);assert.equal(preserved.classTeacherId,null);
  const faculty=await get(actor,3,'/api/administration/section-faculty');assert.equal(faculty.status,200);assert.ok(faculty.body.rows.some(r=>r._id==='teacher'));assert.ok(faculty.body.rows.some(r=>r._id==='section-peer'));assert.ok(!faculty.body.rows.some(r=>['section-inactive','section-disabled','section-hidden','section-foreign'].includes(r._id)));
  for(const invalid of ['section-inactive','section-disabled','section-hidden','section-foreign'])assert.equal((await save({classTeacherId:invalid})).status,400);
  assert.equal((await save({classTeacherId:'section-peer'})).status,200);
  const rows=await get(actor,5,'/api/administration/sections'),row=rows.body.rows.find(r=>r.code===code);assert.equal(row.classTeacherId,'section-peer');assert.equal(row.classTeacher._id,'section-peer');assert.equal(row.classTeacher.active,true);assert.equal(row.classTeacher.name,'Active department colleague');
  assert.equal((await save({room:'Partial edit keeps teacher'})).status,200);assert.equal((await database.collection('sectionDetails').findOne({_id:fresh._id})).classTeacherId,'section-peer');
  assert.equal((await save({classTeacherId:''})).status,200);assert.equal((await database.collection('sectionDetails').findOne({_id:fresh._id})).classTeacherId,null);assert.equal((await database.collection('sectionDetails').findOne({_id:fresh._id})).maximumCapacity,73);
 }
 assert.equal((await call('department-admin',5,'/api/administration/master',{kind:'sections',code:'GLOBAL',status:'active',catalogOnly:true})).status,403);
 assert.equal((await call('department-admin',5,'/api/administration/master',{kind:'schemes',code:'NEW',name:'Forbidden',status:'active'})).status,403);
 for(const [name,rows]of Object.entries(before))assert.deepEqual(await database.collection(name).find({}).sort({_id:1}).toArray(),rows,name+' unchanged');
 assert.equal(await database.collection('users').countDocuments(),facultyCount);assert.equal(authMutations,0);
});
test('test-data scan is read-only and cleanup/resume require explicit confirmation',async()=>{
 const names=(await database.listCollections().toArray()).map(c=>c.name).filter(n=>!n.startsWith('system.')),before={};
 for(const name of names)before[name]=await database.collection(name).find({}).sort({_id:1}).toArray();
 const scan=await get('super',5,'/api/administration/test-data-cleanup');assert.equal(scan.status,200,JSON.stringify(scan.body));
 assert.equal((await get('department-admin',5,'/api/administration/test-data-cleanup')).status,403);
 assert.equal((await call('super',5,'/api/administration/test-data-cleanup/purge',{fingerprint:'a'.repeat(64)})).status,400);
 assert.equal((await call('super',5,'/api/administration/test-data-cleanup/resume',{id:'b'.repeat(64)})).status,400);
 for(const [name,rows]of Object.entries(before))assert.deepEqual(await database.collection(name).find({}).sort({_id:1}).toArray(),rows,name+' unchanged by scan');
 assert.equal(authMutations,0);
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
   for(const width of [1366,768,390]){
    await page.setViewportSize({width,height:900});
    const position=await page.locator('#departmentContext').evaluate(el=>getComputedStyle(el).position);assert.equal(position,'static',actor+' normal positioning at '+width);
    const scroll=page.locator('.department-scroll');
    await scroll.evaluate(async el=>{el.scrollTop=0;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    const initial=await page.locator('#departmentContext').boundingBox();
    await scroll.evaluate(async el=>{el.scrollTop=400;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    const moved=await page.locator('#departmentContext').boundingBox(),delta=await scroll.evaluate(el=>el.scrollTop),viewport=await scroll.boundingBox();
    assert.ok(delta>=300,actor+' page can scroll at '+width);
    assert.ok(Math.abs(initial.y-moved.y-delta)<2,actor+' panel moves with scroll at '+width);
    assert.ok(moved.y+moved.height<=viewport.y+2,actor+' panel leaves view at '+width);
    assert.equal(await page.locator('#managementSemester').inputValue(),'5');
    await scroll.evaluate(async el=>{el.scrollTop=0;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    const restored=await page.locator('#departmentContext').boundingBox();assert.ok(Math.abs(restored.y-initial.y)<2,actor+' panel returns on scroll up at '+width);
   }
   await page.setViewportSize({width:1366,height:900});
   await page.locator('#toggleDirectory').click();
   const fifthResponse=page.waitForResponse(r=>r.url().endsWith('/api/administration/directory'));
   await page.locator('#departmentDirectory [name=status]').selectOption('active');
   const fifth=await(await fifthResponse).json();assert.equal(fifth.total,265);assert.ok(fifth.rows.every(r=>Number(r.semester)===5));
   const options=await page.locator('#managementSemester option').allTextContents();assert.deepEqual(options,['1st Semester','2nd Semester','3rd Semester','4th Semester','5th Semester','6th Semester','7th Semester','8th Semester']);
   await page.locator('#managementSemester').selectOption('3');await page.waitForLoadState('load');await page.locator('#importFile').waitFor();
   assert.equal(await page.locator('#managementSemester').inputValue(),'3');assert.match(await page.locator('#importTarget').innerText(),/Target Semester: 3/);
   await page.locator('#toggleDirectory').click();
   const thirdResponse=page.waitForResponse(r=>r.url().endsWith('/api/administration/directory'));
   await page.locator('#departmentDirectory [name=status]').selectOption('active');
   const third=await(await thirdResponse).json();assert.equal(third.total,1);assert.ok(third.rows.every(r=>Number(r.semester)===3));
   if(actor==='super')assert.equal(await page.locator('#managementDepartment').inputValue(),'dept_ISE');

   if(actor==='super')await page.locator('body.workspace-ready').waitFor();
   if(await page.locator('#importType').isVisible())await page.locator('#importType').selectOption('students');else assert.equal(await page.locator('#importType').inputValue(),'students');
   const csv='usn,auid,name,college_email,phone,scheme,semester,section,mentor_employee_id\r\nSEM5NEWUI,SEM5AUI,Preview Only,preview.ui@college.test,9876543210,2022,5,A,ISE-FAC-001';
   await page.locator('#importFile').setInputFiles({name:'wrong-semester.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
   await page.locator('#previewBtn').click();await page.locator('#importPreview tbody tr').waitFor();
   assert.equal(await page.locator('#importPreview tbody td:nth-child(10)').innerText(),'ERROR');assert.match(await page.locator('#importPreview').innerText(),/Managing Semester 3/);assert.equal(await page.locator('#importBtn').isDisabled(),true);
   const columns=await page.locator('#importPreview th').allTextContents();assert.deepEqual(columns,['#','Name','USN','AUID','Email','Department','Semester','Section','Mentor','Status','Validation details']);
   await page.setViewportSize({width:390,height:844});const layout=await page.locator('#importPreview .table-scroll').evaluate(el=>({scrolls:el.scrollWidth>el.clientWidth,status:getComputedStyle(el.querySelector('td:nth-child(10)')).whiteSpace,details:getComputedStyle(el.querySelector('td:nth-child(11)')).whiteSpace}));assert.deepEqual(layout,{scrolls:true,status:'nowrap',details:'normal'});
   await page.setViewportSize({width:1366,height:900});await page.screenshot({path:fileURLToPath(new URL('../migration-output/semester-context-'+actor+'.png',import.meta.url)),fullPage:true});

   const protectedNames=['students','subjects','offerings','enrollments','marks','noDueRequests','approvals'],preserved={};for(const name of protectedNames)preserved[name]=await database.collection(name).find({}).sort({_id:1}).toArray();
   await database.collection('sectionDetails').updateOne({departmentId:'dept_ISE',semester:3,section:'A'},{$set:{classTeacherId:'teacher',maximumCapacity:85}});
   await page.locator('.super-tabs a[href="#academic-setup"]').click();await page.locator('#sectionList th').filter({hasText:'Class Teacher'}).waitFor();
   await page.locator('#showSectionEditor').click();assert.equal(await page.locator('#sectionForm [name=maximumCapacity]').count(),0);
   const code=actor==='super'?'SUI':'DUI';await page.locator('#sectionForm [name=code]').fill(code);await page.locator('#sectionForm .btn-primary').click();
   const added=page.locator('#sectionList tbody tr').filter({has:page.getByRole('cell',{name:code,exact:true})});await added.waitFor();assert.equal(await added.locator('td').nth(1).innerText(),'Not assigned');
   await added.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#sectionForm [name=classTeacherId] option[value="section-peer"]').waitFor({state:'attached'});
   assert.equal(await page.locator('#sectionForm [name=maximumCapacity]').count(),0);assert.equal(await page.locator('#sectionForm [name=classTeacherId]').inputValue(),'');assert.equal(await page.locator('#sectionForm [name=classTeacherId]').evaluate(el=>el.required),false);
   const facultyOptions=await page.locator('#sectionForm [name=classTeacherId] option').evaluateAll(rows=>rows.map(r=>r.value));assert.ok(!facultyOptions.some(id=>['section-inactive','section-disabled','section-hidden','section-foreign'].includes(id)));
   await page.locator('#sectionForm [name=room]').fill('Optional teacher room');await page.locator('#sectionForm .btn-primary').click();await page.locator('#sectionEditor').waitFor({state:'hidden'});assert.equal((await database.collection('sectionDetails').findOne({departmentId:'dept_ISE',semester:3,section:code})).classTeacherId,null);
   const existing=page.locator('#sectionList tbody tr').filter({has:page.locator('[data-edit=section_A]')});assert.equal(await existing.locator('td').nth(1).innerText(),'teacher');
   await existing.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#sectionForm [name=classTeacherId] option[value="section-peer"]').waitFor({state:'attached'});assert.equal(await page.locator('#sectionForm [name=classTeacherId]').inputValue(),'teacher');
   await page.locator('#sectionForm [name=classTeacherId]').selectOption('section-peer');await page.locator('#sectionForm .btn-primary').click();await page.locator('#sectionEditor').waitFor({state:'hidden'});await existing.getByText('Active department colleague',{exact:true}).waitFor();
   assert.equal((await database.collection('sectionDetails').findOne({departmentId:'dept_ISE',semester:3,section:'A'})).maximumCapacity,85);
   await existing.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#sectionForm [name=classTeacherId] option[value="section-peer"]').waitFor({state:'attached'});assert.equal(await page.locator('#sectionForm [name=classTeacherId]').inputValue(),'section-peer');
   await page.locator('#sectionForm [name=classTeacherId]').selectOption('');await page.locator('#sectionForm .btn-primary').click();await page.locator('#sectionEditor').waitFor({state:'hidden'});await existing.getByRole('cell',{name:'Not assigned',exact:true}).waitFor();
   if(actor==='super'){
    let scans=0,cleanupPosts=0;page.on('request',r=>{if(r.url().includes('/api/administration/test-data-cleanup')){if(r.method()==='GET')scans++;if(r.method()==='POST')cleanupPosts++;}});
    await page.locator('.super-tabs a[href="#institution-settings"]').click();const maintenance=page.locator('#advancedMaintenance');await maintenance.waitFor();assert.equal(await maintenance.evaluate(el=>el.open),false);assert.equal(scans,0);assert.equal(await maintenance.getByRole('button',{name:'Scan Test Data',exact:true}).isVisible(),false);
    await maintenance.locator('summary').click();assert.equal(scans,0);assert.match(await maintenance.innerText(),/Scanning does not delete or modify data/);
    const beforeScan={};for(const name of (await database.listCollections().toArray()).map(c=>c.name).filter(n=>!n.startsWith('system.')))beforeScan[name]=await database.collection(name).find({}).sort({_id:1}).toArray();
    await maintenance.getByRole('button',{name:'Scan Test Data',exact:true}).click();await maintenance.getByText('Scan complete. Nothing was deleted.',{exact:true}).waitFor();assert.equal(scans,1);
    for(const [name,rows]of Object.entries(beforeScan))assert.deepEqual(await database.collection(name).find({}).sort({_id:1}).toArray(),rows,name+' untouched by browser scan');
    const scanResult={counts:{users:1},detach:{},retainedHistory:{},firebaseAccounts:1,integrityIssues:0,unclassifiedLegacy:{},blocked:[],authBlocked:'',backupReady:true,total:1,fingerprint:'a'.repeat(64),pendingJob:null};
    await page.route('**/api/administration/test-data-cleanup',route=>route.fulfill({status:200,json:scanResult}));
    await maintenance.getByRole('button',{name:'Scan Test Data',exact:true}).click();await maintenance.locator('[data-purge]').waitFor();assert.equal(await maintenance.locator('[data-purge]').isDisabled(),true);await maintenance.locator('[data-confirm]').fill('wrong');assert.equal(await maintenance.locator('[data-purge]').isDisabled(),true);await maintenance.locator('[data-confirm]').fill('PURGE TEST DATA');assert.equal(await maintenance.locator('[data-purge]').isEnabled(),true);
    scanResult.pendingJob='b'.repeat(64);await maintenance.getByRole('button',{name:'Scan Test Data',exact:true}).click();const resume=maintenance.getByRole('button',{name:'Resume reviewed cleanup',exact:true});await resume.waitFor();assert.equal(await resume.isDisabled(),true);await maintenance.locator('[data-resume-confirm]').fill('PURGE TEST DATA');assert.equal(await resume.isEnabled(),true);assert.equal(cleanupPosts,0);
   }else assert.equal(await page.locator('#advancedMaintenance').count(),0);
   for(const [name,rows]of Object.entries(preserved))assert.deepEqual(await database.collection(name).find({}).sort({_id:1}).toArray(),rows,name+' preserved across section edits');


   assert.deepEqual(errors,[]);await context.close();
  }
 }finally{await browser.close();await new Promise(resolve=>backend.close(resolve));await new Promise(resolve=>frontend.close(resolve));}
 assert.equal(authMutations,0);
});

