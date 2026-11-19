
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {connectDatabase} from '../src/db.js';
import {createApp} from '../src/app.js';
import {enrollmentPlan} from '../src/services/clearance.js';
import {requiredServices} from '../../js/workflow-services.js';
import request from 'supertest';
let memory,client,database,app,store,authChanges=0;
const auth={verifyIdToken:async uid=>({uid}),getUser:async uid=>({uid,disabled:false,email:uid+'@college.test'}),createUser:async()=>{authChanges++;throw Error('Unexpected Auth mutation');},updateUser:async()=>{authChanges++;throw Error('Unexpected Auth mutation');},deleteUser:async()=>{authChanges++;throw Error('Unexpected Auth mutation');}};
const post=(uid,path,body,sem=3,dep='dept_A')=>request(app).post(path).set('Authorization','Bearer '+uid).set('X-Department-Id',uid==='super'?dep:'').set('X-Semester',String(sem)).send(body);
const get=(uid,path,sem=3,dep='dept_A')=>request(app).get(path).set('Authorization','Bearer '+uid).set('X-Department-Id',uid==='super'?dep:'').set('X-Semester',String(sem));
const action=(uid,id,body)=>post(uid,'/api/requests/'+id+'/actions',body);
before(async()=>{
 memory=await MongoMemoryReplSet.create({replSet:{storageEngine:'wiredTiger'}});
 ({client,database}=await connectDatabase(memory.getUri('workflow_requirements_test')));({app,store}=createApp({database,client,auth,demo:true,origins:['http://127.0.0.1:5067']}));
 await database.collection('institutionPolicy').insertMany([{_id:'institution',sections:['A']},{_id:'workflow',library:'library',accounts:'accounts',sports:'sports',physics_lab:'physics_lab',chemistry_lab:'chemistry_lab'}]);
 await database.collection('users').insertMany([{_id:'super',role:'super_admin',name:'Super Admin',email:'super@college.test'},...['library','accounts','sports','physics_lab','chemistry_lab'].map(role=>({_id:role,role,name:role,email:role+'@college.test',scope:'institution',accountStatus:'active'}))]);
 for(const code of ['A','B']){
  const did='dept_'+code;
  await database.collection('departments').insertOne({_id:did,code,name:'Department '+code,codeKey:code.toLowerCase(),nameKey:code.toLowerCase(),status:'active',hodId:'hod'+code,adminId:'admin'+code});
  for(const[uid,role]of [['admin','admin'],['teacher','subject_faculty'],['mentor','mentor'],['hod','hod'],['office','office']])await database.collection('users').insertOne({_id:uid+code,name:uid+code,role,email:uid+code+'@college.test',departmentId:did,department:code,scope:'department',accountStatus:'active'});
  await database.collection('departmentWorkflows').insertOne({_id:did,departmentId:did,hodId:'hod'+code,officeId:'office'+code,officeScopeVersion:2,library:'library',accounts:'accounts'});
  for(let semester=1;semester<=8;semester++){
   const uid='student'+code+semester,oid='offering'+code+semester,eid=uid+'__'+oid,profile={name:'Student '+code+semester,role:'student',email:uid+'@college.test',usn:'USN'+code+semester,departmentId:did,department:code,semester,section:'A',scheme:'2025',mentorId:'mentor'+code,offeringIds:[oid],teacherIds:['teacher'+code],accountStatus:'active'};
   await database.collection('users').insertOne({_id:uid,...profile});await database.collection('students').insertOne({_id:uid,uid,...profile});
   await database.collection('subjects').insertOne({_id:'subject'+code+semester,name:'Subject',code:'SUB'+semester,departmentId:did,department:code,semester,scheme:'2025'});
   await database.collection('offerings').insertOne({_id:oid,subjectId:'subject'+code+semester,subjectCode:'SUB'+semester,subjectName:'Subject',departmentId:did,department:code,semester,section:'A',scheme:'2025',teacherId:'teacher'+code,active:true,components:[{id:'ia1',label:'IA1',max:25}]});
   await database.collection('enrollments').insertOne({_id:eid,studentId:uid,offeringId:oid,teacherId:'teacher'+code,mentorId:'mentor'+code,active:true});
  }
 }
});
after(async()=>{await client?.close();await memory?.stop();});
test('every department and semester gets subject faculty, Library, Accounts, Sports and only default first-year labs',async()=>{
 for(const code of ['A','B'])for(let semester=1;semester<=8;semester++){
  const plan=await enrollmentPlan(store,'student'+code+semester),types=Object.values(plan.items).map(i=>i.approverType);
  for(const type of ['subject_faculty','library','accounts','sports'])assert.ok(types.includes(type));
  for(const lab of ['physics_lab','chemistry_lab'])assert.equal(types.includes(lab),semester<=2);
 }
});
test('Semesters 1, 2, 3 and 5 complete in either Stage 1 order; Mentor/HOD/Office never unlock early',async()=>{
 for(const code of ['A','B'])for(const semester of [1,2,3,5]){
  const uid='student'+code+semester,result=await post(uid,'/api/requests',{requestKey:'workflow_'+code+'_'+semester}),id=result.body.id;assert.equal(result.status,200,JSON.stringify(result.body));
  let r=await database.collection('noDueRequests').findOne({_id:id});assert.equal((await action('mentor'+code,id,{action:'mentor',decision:'approved'})).status,403);
  assert.equal((await action('hod'+code,id,{action:'hod',decision:'approved'})).status,403);assert.equal((await action('office'+code,id,{action:'issue'})).status,403);
  const items=Object.entries(r.approvalItems);if(semester%2)items.reverse();
  for(const[key,item]of items){
   assert.equal((await action(item.approverId,id,{action:'stage1',approvalId:key,decision:'approved'})).status,200);
   r=await database.collection('noDueRequests').findOne({_id:id});
   if(r.remaining){assert.equal(r.status,'pending_stage1');assert.equal((await action('mentor'+code,id,{action:'mentor',decision:'approved'})).status,403);}
  }
  assert.equal(r.status,'pending_mentor');assert.equal((await action('office'+code,id,{action:'issue'})).status,403);
  assert.equal((await action('mentor'+code,id,{action:'mentor',decision:'approved'})).status,200);assert.equal((await action('office'+code,id,{action:'issue'})).status,403);
  assert.equal((await action('hod'+code,id,{action:'hod',decision:'approved'})).status,200);assert.equal((await action('office'+code,id,{action:'issue'})).status,200);
  assert.equal((await database.collection('noDueRequests').findOne({_id:id})).status,'issued');
  const sports=await database.collection('approvals').findOne({_id:id+'/sports'});assert.equal(sports.actorId,'sports');assert.equal(sports.status,'approved');assert.ok(sports.actedAt instanceof Date);
  assert.ok(await database.collection('notifications').findOne({requestId:id,actorId:'sports',approvalType:'sports',decision:'approved'}));
 }
 assert.equal(authChanges,0);
});
test('Sports sees assigned requests across departments and semesters; rejection/resubmission preserves sibling decisions and history',async()=>{
 const ids=[];for(const code of ['A','B'])ids.push((await post('student'+code+'4','/api/requests',{requestKey:'sports_queue_'+code})).body.id);
 const list=await post('sports','/api/data/query',{path:'noDueRequests',filters:[['status','==','pending_stage1']],limit:100});assert.equal(list.status,200);for(const id of ids)assert.ok(list.body.rows.some(r=>r.id===id));
 for(const path of ['subjects','students','offerings','marks'])assert.equal((await post('sports','/api/data/query',{path})).status,403);
 assert.equal((await get('sports','/api/academic/student/studentA4')).status,403);
 assert.equal((await post('sports','/api/administration/workflow-requirements',{semester:3,physics_lab:false,chemistry_lab:false})).status,403);
 const id=ids[0];assert.equal((await action('library',id,{action:'stage1',approvalId:'library',decision:'approved'})).status,200);
 assert.equal((await action('sports',id,{action:'stage1',approvalId:'sports',decision:'rejected',reason:'Return sports equipment'})).status,200);
 assert.equal((await action('studentA4',id,{action:'resubmit'})).status,200);const resumed=await database.collection('noDueRequests').findOne({_id:id});assert.equal(resumed.approvalStates.library,'approved');assert.equal(resumed.approvalStates.sports,'pending');
 assert.ok(await database.collection('notifications').findOne({requestId:id,actorId:'sports',decision:'rejected',reason:'Return sports equipment'}));
 assert.equal((await action('sports',ids[1],{action:'mentor',decision:'approved'})).status,403);
 await database.collection('noDueRequests').insertOne({_id:'unassigned_sports_request',studentId:'studentB8',status:'pending_stage1',approverIds:['teacherB'],approvalItems:{},approvalStates:{}});
 assert.equal((await post('sports','/api/data/read',{path:'noDueRequests/unassigned_sports_request'})).status,403);
});
test('lab overrides affect only the selected department/semester and new requests, preserving existing/completed requests',async()=>{
 const beforeRequests=await database.collection('noDueRequests').find({}).sort({_id:1}).toArray(),beforeApprovals=await database.collection('approvals').find({}).sort({_id:1}).toArray(),academics={};for(const n of ['students','subjects','offerings','enrollments','marks'])academics[n]=await database.collection(n).find({}).sort({_id:1}).toArray();
 const prior=await get('adminA','/api/administration/workflow-requirements',3);assert.equal(prior.status,200);assert.equal(prior.body.semesters[0].labs.physics_lab,true);assert.equal(prior.body.semesters[2].labs.physics_lab,false);
 assert.equal((await post('adminA','/api/administration/workflow-requirements',{semester:3,physics_lab:true,chemistry_lab:false},3)).status,200);
 assert.equal((await enrollmentPlan(store,'studentA3')).items.physics_lab.approverType,'physics_lab');assert.equal((await enrollmentPlan(store,'studentA3')).items.chemistry_lab,undefined);
 assert.equal((await enrollmentPlan(store,'studentB3')).items.physics_lab,undefined);assert.equal((await enrollmentPlan(store,'studentA5')).items.physics_lab,undefined);
 const existing=beforeRequests.find(r=>r.studentId==='studentA3');assert.equal((await enrollmentPlan(store,'studentA3',{existingRequest:existing})).items.physics_lab,undefined);
 assert.equal((await post('adminA','/api/administration/workflow-requirements',{semester:1,physics_lab:false,chemistry_lab:false},1)).status,200);
 assert.deepEqual(requiredServices(await database.collection('departmentWorkflows').findOne({_id:'dept_A'}),1),['library','accounts','sports']);
 assert.equal((await post('adminA','/api/administration/workflow-requirements',{semester:5,physics_lab:true,chemistry_lab:false},3)).status,400);
 assert.equal((await post('adminA','/api/administration/workflow-requirements',{semester:3,physics_lab:false,chemistry_lab:false,sports:false},3)).status,400);
 assert.equal((await request(app).get('/api/administration/workflow-requirements').set('Authorization','Bearer adminA').set('X-Department-Id','dept_B').set('X-Semester','3')).status,403);
 assert.deepEqual(await database.collection('noDueRequests').find({}).sort({_id:1}).toArray(),beforeRequests);assert.deepEqual(await database.collection('approvals').find({}).sort({_id:1}).toArray(),beforeApprovals);
 for(const[n,rows]of Object.entries(academics))assert.deepEqual(await database.collection(n).find({}).sort({_id:1}).toArray(),rows);
 assert.ok(await database.collection('superAdminAudit').findOne({action:'WORKFLOW_LAB_REQUIREMENTS_UPDATED',departmentId:'dept_A',semester:3}));assert.equal(authChanges,0);
});
test('Super Admin and Department Admin show all eight semester requirements and save only the selected labs',async()=>{
 const {chromium}=await import('playwright'),{default:express}=await import('express'),{fileURLToPath}=await import('node:url'),backend=app.listen(0,'127.0.0.1');await new Promise(r=>backend.once('listening',r));const frontend=express().use(express.static(fileURLToPath(new URL('../..',import.meta.url)))).listen(5067,'127.0.0.1'),browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const actor of ['super','adminA']){
  const c=await browser.newContext(),p=await c.newPage();p.setDefaultTimeout(15000);
  await c.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const auth={currentUser:{uid:'+JSON.stringify(actor)+',getIdToken:async()=>'+JSON.stringify(actor)+'}};'}));
  await c.route('**/js/api-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const API_BASE_URL='+JSON.stringify('http://127.0.0.1:'+backend.address().port)+';'}));
  await p.goto('http://127.0.0.1:5067/login.html');await p.evaluate(({actor})=>{sessionStorage.setItem('department-context:'+actor,'dept_A');sessionStorage.setItem('semester-context:'+actor+':dept_A','3');document.body.innerHTML='<main id="content"></main>';location.hash='workflow-setup';}, {actor});
  await p.evaluate(async actor=>{const{mountWorkflowRequirements}=await import('/js/workflow-requirements-ui.js');mountWorkflowRequirements(document.getElementById('content'),{uid:actor,role:actor==='super'?'super_admin':'admin'},'dept_A');},actor);
  const panel=p.locator('#semesterWorkflowRequirements');await panel.locator('tbody tr').last().waitFor();assert.equal(await panel.locator('tbody tr').count(),8);assert.match(await panel.innerText(),/Common mandatory/);assert.match(await panel.innerText(),/Library.*Accounts.*Sports/);
  const before=await database.collection('noDueRequests').find({}).sort({_id:1}).toArray();await panel.locator('[name=physics_lab]').uncheck();await panel.locator('[name=chemistry_lab]').check();await panel.getByRole('button',{name:'Save semester requirements',exact:true}).click();await panel.getByText('Semester requirements saved. Existing requests were not changed.',{exact:true}).waitFor();assert.deepEqual((await database.collection('departmentWorkflows').findOne({_id:'dept_A'})).labRequirements['3'],{physics_lab:false,chemistry_lab:true});assert.deepEqual(await database.collection('noDueRequests').find({}).sort({_id:1}).toArray(),before);await c.close();
 }}finally{await browser.close();await new Promise(r=>backend.close(r));await new Promise(r=>frontend.close(r));}assert.equal(authChanges,0);
});

test('Semester 3 workflow account setup does not require globally configured labs; Semester 1 still requires enabled labs',async()=>{
 const policy=await database.collection('institutionPolicy').findOne({_id:'workflow'}),workflow=await database.collection('departmentWorkflows').findOne({_id:'dept_A'}),requests=await database.collection('noDueRequests').find({}).sort({_id:1}).toArray();
 try{
  await database.collection('institutionPolicy').updateOne({_id:'workflow'},{$unset:{physics_lab:'',chemistry_lab:''}});
  await database.collection('departmentWorkflows').updateOne({_id:'dept_A'},{$unset:{physics_lab:'',chemistry_lab:'',labRequirements:''}});
  const body={serviceMode:'institution',hodId:'hodA',officeId:'officeA',library:'library',accounts:'accounts',sports:'sports'};
  assert.equal((await post('super','/api/administration/workflow',body,3)).status,200);
  assert.equal((await post('super','/api/administration/workflow',body,1)).status,400);
  assert.deepEqual(await database.collection('noDueRequests').find({}).sort({_id:1}).toArray(),requests);
 }finally{await database.collection('institutionPolicy').replaceOne({_id:'workflow'},policy);await database.collection('departmentWorkflows').replaceOne({_id:'dept_A'},workflow);}
});
