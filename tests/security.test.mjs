import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,query,where,updateDoc,serverTimestamp,writeBatch} from 'firebase/firestore';
import {useContext} from './runtime.mjs';
import {submitRequest,actOnStage1Item,actAsMentor,actAsHod,resubmit,issueHallTicket} from '../js/workflow.js';
import {academicDetails,page,saveMarks} from '../js/academic.js';
import {saveAccount,preparePlan,saveOffering,enrollStudent} from '../js/admin-data.js';
import {upgradeLegacyRequest} from '../js/workflow.js';
import {approvalHTML} from '../js/student-updates.js';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator} from 'firebase/firestore';
let env,requestId;
const db=uid=>env.authenticatedContext(uid).firestore();
const as=uid=>useContext(db(uid),uid);
const items={faculty:{approverType:'subject_faculty',approverId:'t1',offeringId:'dbmsC',subjectCode:'DBMS',label:'DBMS'},...Object.fromEntries(['library','physics_lab','chemistry_lab','accounts'].map(type=>[type,{approverType:type,approverId:type,offeringId:null,subjectCode:null,label:type}]))};
const initialStates=Object.fromEntries(Object.keys(items).map(k=>[k,'pending']));
const plan={valid:true,items,initialStates,approverIds:Object.values(items).map(i=>i.approverId),mentorId:'m1',hodId:'h1',officeId:'o1',semester:6,section:'C'};
before(async()=>{
  const projectId=process.env.TEST_PROJECT_ID || 'demo-digital-no-due';
  if(!projectId.startsWith('demo-')) throw new Error('Tests require a demo project.');
  env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:Number(process.env.TEST_FIRESTORE_PORT || 8180),rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const store=context.firestore(),batch=writeBatch(store);
    for(const [uid,role] of Object.entries({s1:'student',s2:'student',t1:'subject_faculty',t2:'subject_faculty',m1:'mentor',m2:'mentor',h1:'hod',h2:'hod',o1:'office',o2:'office',a1:'admin',library:'library',physics_lab:'physics_lab',chemistry_lab:'chemistry_lab',accounts:'accounts'})) batch.set(doc(store,'users',uid),{name:uid,email:`${uid}@test.com`,phone:'123',facultyId:uid,department:'CSE',role});
    for(const uid of ['s1','s2']) {
      batch.set(doc(store,'students',uid),{uid,name:uid,usn:`USN${uid}`,email:`${uid}@test.com`,phone:'123',semester:6,section:uid==='s1'?'C':'D',mentorId:uid==='s1'?'m1':'m2',offeringIds:[uid==='s1'?'dbmsC':'dbmsD'],teacherIds:[uid==='s1'?'t1':'t2']});
      batch.set(doc(store,'students',uid,'clearance','plan'),uid==='s1'?plan:{...plan,semester:6,section:'D',mentorId:'m2'});
    }
    batch.set(doc(store,'subjects','dbms'),{name:'Database Management Systems',code:'DBMS'});
    batch.set(doc(store,'settings','workflow'),{library:'library',physics_lab:'physics_lab',chemistry_lab:'chemistry_lab',accounts:'accounts',hodId:'h1',officeId:'o1'});
    for(const [id,section,teacherId,studentId,mentorId] of [['dbmsC','C','t1','s1','m1'],['dbmsD','D','t2','s2','m2']]) {
      batch.set(doc(store,'offerings',id),{subjectId:'dbms',subjectName:'Database Management Systems',subjectCode:'DBMS',semester:6,section,teacherId,components:[{id:'ia1',label:'Internal 1',max:30},{id:'assignment',label:'Assignment',max:10}],componentIds:['ia1','assignment']});
      batch.set(doc(store,'enrollments',`${studentId}__${id}`),{studentId,offeringId:id,teacherId,mentorId,semester:6,section,active:true});
      batch.set(doc(store,'assignments',id),{offeringId:id,title:'Assignment 2',description:'SQL exercises',dueDate:'2026-10-10',status:'Assigned'});
    }
    await batch.commit();
  });
});
after(async()=>env?.cleanup());
test('profiles, mentor, subjects and assignments load only within scope',async()=>{
  as('s1');const details=await academicDetails('s1');assert.equal(details.mentor.id,'m1');assert.equal(details.subjects[0].teacher.id,'t1');assert.equal(details.subjects[0].assignments[0].title,'Assignment 2');
  await assertFails(getDoc(doc(db('s2'),'students','s1')));
  await assertFails(getDoc(doc(db('m2'),'students','s1')));
  await assertFails(getDoc(doc(db('t2'),'students','s1')));
  await assertFails(getDocs(collection(db('m1'),'students')));
  as('m1');assert.equal((await page('students',[['mentorId','==','m1']])).rows.length,1);
  as('t1');assert.equal((await page('offerings',[['teacherId','==','t1']])).rows.length,1);
  assert.equal((await page('enrollments',[['offeringId','==','dbmsC'],['teacherId','==','t1']])).rows.length,1);
});
test('teacher adds and updates own marks; student and unrelated staff writes fail',async()=>{
  as('t1');const enrollment=(await page('enrollments',[['offeringId','==','dbmsC'],['teacherId','==','t1']])).rows[0],offering=(await getDoc(doc(db('t1'),'offerings','dbmsC'))).data();
  await saveMarks(enrollment,{...offering,id:'dbmsC'},{ia1:20,assignment:8},'t1');
  await saveMarks(enrollment,{...offering,id:'dbmsC'},{ia1:25},'t1');
  assert.equal((await getDoc(doc(db('s1'),'marks','s1__dbmsC'))).data().scores.ia1,25);
  await assertSucceeds(getDoc(doc(db('m1'),'marks','s1__dbmsC')));
  for(const uid of ['s1','s2','t2','m1','m2']) await assertFails(updateDoc(doc(db(uid),'marks','s1__dbmsC'),{scores:{ia1:29},updatedBy:uid,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(db('t1'),'marks','s1__dbmsC'),{scores:{ia1:31},updatedBy:'t1',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(db('t1'),'marks','s1__dbmsC'),{scores:{unknownComponent:10},updatedBy:'t1',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(db('t1'),'marks','s1__dbmsC'),{teacherId:'t2',updatedBy:'t1',updatedAt:serverTimestamp()}));
  await assertFails(getDoc(doc(db('s2'),'marks','s1__dbmsC')));
  await assertFails(getDoc(doc(db('s1'),'assignments','dbmsD')));
});
test('student cannot elevate roles or forge institutional records',async()=>{
  await assertFails(updateDoc(doc(db('s1'),'users','s1'),{role:'admin'}));
  await assertFails(updateDoc(doc(db('s1'),'students','s1'),{semester:9}));
  await assertFails(setDoc(doc(db('t1'),'subjects','fake'),{name:'Fake',code:'FAKE'}));
});
test('request auto-populates profile and five required approvers; forged request fails',async()=>{
  as('s1');requestId=await submitRequest();const r=(await getDoc(doc(db('s1'),'noDueRequests',requestId))).data();
  assert.equal(r.usn,'USNs1');assert.equal(r.mentorId,'m1');assert.equal(r.remaining,5);assert.equal(r.approvalItems.faculty.approverId,'t1');
  await assertFails(setDoc(doc(db('s1'),'noDueRequests','forged'),{...r,studentId:'s2',createdAt:serverTimestamp()}));
  await assertFails(setDoc(doc(db('s1'),'noDueRequests','omitted'),{...r,remaining:0,approvalStates:{},createdAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(db('s1'),'noDueRequests',requestId),{status:'cleared'}));
  await assertFails(getDoc(doc(db('s2'),'noDueRequests',requestId)));
  await assertFails(getDoc(doc(db('m2'),'noDueRequests',requestId)));
});
test('teacher rejection requires reason, notifies only owner, and resubmits correctly',async()=>{
  as('t1');await assert.rejects(()=>actOnStage1Item(requestId,'faculty','rejected',''));
  await actOnStage1Item(requestId,'faculty','rejected','Assignment 2 has not been submitted.');
  const r=(await getDoc(doc(db('s1'),'noDueRequests',requestId))).data();assert.equal(r.status,'rejected');assert.equal(r.lastEvent.subjectCode,'DBMS');
  const n=await getDocs(collection(db('s1'),'users','s1','notifications'));assert.equal(n.docs[0].data().reason,'Assignment 2 has not been submitted.');
  await assertFails(getDocs(collection(db('s2'),'users','s1','notifications')));
  as('s1');await resubmit(requestId);assert.equal((await getDoc(doc(db('s1'),'noDueRequests',requestId))).data().approvalStates.faculty,'pending');
});
test('parallel approvals, mentor/HOD rejection and office issuance follow exact stages',async()=>{
  as('t2');await assert.rejects(()=>actOnStage1Item(requestId,'faculty','approved',''));
  as('h1');await assert.rejects(()=>actAsHod(requestId,'approved',''));
  as('t1');await actOnStage1Item(requestId,'faculty','approved','');
  for(const type of ['library','physics_lab','chemistry_lab','accounts']) {as(type);await actOnStage1Item(requestId,type,'approved','');}
  assert.equal((await getDoc(doc(db('s1'),'noDueRequests',requestId))).data().status,'pending_mentor');
  as('m1');await actAsMentor(requestId,'rejected','Mentor meeting pending');as('s1');await resubmit(requestId);
  as('m1');await actAsMentor(requestId,'approved','');as('h1');await actAsHod(requestId,'rejected','Department review pending');
  as('s1');await resubmit(requestId);as('h1');await actAsHod(requestId,'approved','');
  as('o2');await assert.rejects(()=>issueHallTicket(requestId));as('o1');await issueHallTicket(requestId);
  const r=(await getDoc(doc(db('s1'),'noDueRequests',requestId))).data();assert.equal(r.status,'issued');assert.equal(r.remaining,0);assert.equal(r.issuedById,'o1');
  const ns=await getDocs(collection(db('s1'),'users','s1','notifications'));assert.equal(ns.size,r.version);assert.ok(ns.docs.some(d=>d.data().reason==='Mentor meeting pending'));assert.ok(ns.docs.some(d=>d.data().reason==='Department review pending'));
  await assertFails(updateDoc(doc(db('s1'),'noDueRequests',requestId),{status:'pending_stage1'}));
});
test('admin manages records; unauthenticated reads fail',async()=>{
  await assertSucceeds(setDoc(doc(db('a1'),'subjects','newSubject'),{name:'Java',code:'JAVA'}));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'students','s1')));
});
test('student, teacher and mentor can log in using Firebase Authentication and read own role',async()=>{
  const app=initializeApp({apiKey:'fake-api-key',projectId:process.env.TEST_PROJECT_ID || 'demo-digital-no-due'},'auth-test');
  const auth=getAuth(app);connectAuthEmulator(auth,`http://127.0.0.1:${process.env.TEST_AUTH_PORT || 9199}`,{disableWarnings:true});
  const store=getFirestore(app);connectFirestoreEmulator(store,'127.0.0.1',Number(process.env.TEST_FIRESTORE_PORT || 8180));
  try {
    for(const role of ['student','subject_faculty','mentor']) {
      const email=`login-${role}-${Date.now()}@test.com`,password='TestPassword123!';
      const credential=await createUserWithEmailAndPassword(auth,email,password);
      await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'users',credential.user.uid),{name:role,role,email}));
      await signOut(auth);await signInWithEmailAndPassword(auth,email,password);
      assert.equal((await getDoc(doc(store,'users',auth.currentUser.uid))).data().role,role);
      await signOut(auth);
    }
  } finally {await deleteApp(app);}
});
test('admin links profiles, classes and marks; mentor writes only independently assigned subjects',async()=>{
  as('a1');await saveAccount({uid:'s3',role:'student',name:'Student Three',email:'s3@test.com',usn:'USNs3',semester:'6',section:'C',mentorId:'m1'});
  await saveOffering({id:'javaC',subjectId:'newSubject',teacherId:'m1',semester:6,section:'C',components:[{id:'ia',label:'Internal',max:50}]});
  await enrollStudent('s3','javaC');
  const ready=await preparePlan('s3');assert.equal(ready.items.subject_javaC.approverId,'m1');
  as('m1');const en=(await page('enrollments',[['studentId','==','s3']])).rows[0];
  const o=(await getDoc(doc(db('m1'),'offerings','javaC'))).data();
  await saveMarks(en,{...o,id:'javaC'},{ia:40},'m1');
  await assertFails(updateDoc(doc(db('t1'),'marks',en.id),{scores:{ia:20},updatedBy:'t1',updatedAt:serverTimestamp()}));
  as('s3');const details=await academicDetails('s3');assert.equal(details.subjects[0].marks.scores.ia,40);
});
test('legacy upgrade preserves existing approvals and resubmits multiple rejected items',async()=>{
  const legacy={studentId:'s1',studentName:'s1',usn:'USNs1',semester:6,section:'C',mentorId:'m1',status:'rejected',mentorApproval:{status:'pending',remarks:''},hodApproval:{status:'pending',remarks:''},createdAt:serverTimestamp()};
  await env.withSecurityRulesDisabled(async c=>{
    const b=writeBatch(c.firestore());b.set(doc(c.firestore(),'noDueRequests','legacy'),legacy);
    for(const [key,item] of Object.entries(items)) b.set(doc(c.firestore(),'noDueRequests','legacy','approvals',key),{...item,studentId:'s1',requestId:'legacy',status:key==='faculty'||key==='library'?'rejected':'approved',remarks:key==='faculty'?'Assignment pending':key==='library'?'Book pending':''});
    await b.commit();
  });
  as('a1');await upgradeLegacyRequest('legacy',plan);
  assert.match(approvalHTML((await getDoc(doc(db('a1'),'noDueRequests','legacy'))).data()),/Assignment pending/);
  as('s1');await resubmit('legacy');const r=(await getDoc(doc(db('s1'),'noDueRequests','legacy'))).data();
  assert.equal(r.approvalStates.faculty,'pending');assert.equal(r.approvalStates.library,'pending');assert.equal(r.approvalStates.accounts,'approved');assert.equal(r.remaining,2);
});
test('forged complete transaction cannot skip remaining Stage 1 approvals',async()=>{
  as('s1');const id=await submitRequest(),store=db('t1'),r=(await getDoc(doc(store,'noDueRequests',id))).data();
  const event={requestId:id,studentId:'s1',actorId:'t1',actorName:'t1',actorType:'subject_faculty',subjectCode:'DBMS',reason:'',status:'pending_mentor',version:1,createdAt:serverTimestamp()};
  const batch=writeBatch(store);batch.update(doc(store,'noDueRequests',id),{approvalStates:{...r.approvalStates,faculty:'approved'},resubmissionStates:{...r.approvalStates,faculty:'approved'},remaining:0,lastApprovalId:'faculty',status:'pending_mentor',version:1,lastEvent:event,updatedAt:serverTimestamp()});
  batch.set(doc(store,'users','s1','notifications',`${id}_1`),event);
  await assertFails(batch.commit());
});
test('concurrent decisions keep counter and notification versions consistent',async()=>{
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'students','s1','clearance','plan'),{...plan,items:{...items,faculty2:items.faculty},initialStates:{...initialStates,faculty2:'pending'}}));
  as('s1');const id=await submitRequest();as('t1');
  await Promise.all([actOnStage1Item(id,'faculty','approved',''),actOnStage1Item(id,'faculty2','approved','')]);
  const r=(await getDoc(doc(db('s1'),'noDueRequests',id))).data();assert.equal(r.remaining,4);assert.equal(r.version,2);assert.equal(r.approvalStates.faculty,'approved');assert.equal(r.approvalStates.faculty2,'approved');
  assert.equal((await getDoc(doc(db('s1'),'users','s1','notifications',`${id}_1`))).exists(),true);
  assert.equal((await getDoc(doc(db('s1'),'users','s1','notifications',`${id}_2`))).exists(),true);
});
test('305 student and 100 teacher fixtures remain scoped and paginate',async()=>{
  await env.withSecurityRulesDisabled(async c=>{
    const store=c.firestore();let batch=writeBatch(store),count=0;
    async function commitIfFull(){if(count>=400){await batch.commit();batch=writeBatch(store);count=0;}}
    for(let i=0;i<100;i++){batch.set(doc(store,'users',`load-teacher-${i}`),{role:'subject_faculty',name:`Teacher ${i}`,email:`teacher${i}@load.test`});count++;await commitIfFull();}
    for(let i=0;i<305;i++){
      const uid=`load-student-${String(i).padStart(3,'0')}`,own=i<35;
      batch.set(doc(store,'students',uid),{uid,name:`Student ${i}`,usn:`LOAD${i}`,semester:6,section:own?'C':'D',mentorId:own?'m1':'m2',teacherIds:[own?'t1':'t2'],offeringIds:[own?'dbmsC':'dbmsD']});count++;
      batch.set(doc(store,'enrollments',`${uid}__${own?'dbmsC':'dbmsD'}`),{studentId:uid,offeringId:own?'dbmsC':'dbmsD',teacherId:own?'t1':'t2',mentorId:own?'m1':'m2',active:true,semester:6,section:own?'C':'D'});count++;await commitIfFull();
    }
    if(count)await batch.commit();
  });
  as('m1');let first=await page('students',[['mentorId','==','m1']]);assert.equal(first.rows.length,30);assert.equal(first.more,true);
  const second=await page('students',[['mentorId','==','m1']],first.cursor);assert.equal(second.rows.length,7);assert.ok([...first.rows,...second.rows].every(s=>s.mentorId==='m1'));
  as('t1');first=await page('enrollments',[['teacherId','==','t1'],['offeringId','==','dbmsC'],['active','==',true]]);assert.equal(first.rows.length,30);
  const next=await page('enrollments',[['teacherId','==','t1'],['offeringId','==','dbmsC'],['active','==',true]],first.cursor);assert.equal(next.rows.length,6);assert.ok([...first.rows,...next.rows].every(s=>s.teacherId==='t1'&&s.offeringId==='dbmsC'));
});
test('changing a class invalidates plans and immediately removes the old teacher scope',async()=>{
  as('a1');await saveOffering({id:'dbmsC',subjectId:'dbms',teacherId:'t2',semester:6,section:'C',components:[{id:'ia1',label:'Internal 1',max:30}]});
  assert.equal((await getDoc(doc(db('a1'),'students','s1','clearance','plan'))).data().valid,false);
  await assertFails(getDoc(doc(db('t1'),'students','s1')));
  as('s1');await assert.rejects(()=>submitRequest());
  as('a1');await preparePlan('s1');assert.equal((await getDoc(doc(db('a1'),'students','s1','clearance','plan'))).data().items.subject_dbmsC.approverId,'t2');
});

test('one offering contains multiple students with independent marks and accepts later enrollments',async()=>{
  as('a1');
  await saveOffering({id:'roster-check-C',subjectId:'dbms',teacherId:'t1',semester:6,section:'C',components:[{id:'ia1',label:'Internal 1',max:30}]});
  for(const uid of ['rosterA','rosterB']) {
    await saveAccount({uid,role:'student',name:uid,email:`${uid}@test.com`,usn:`USN${uid}`,semester:6,section:'C',mentorId:'m1'});
    await enrollStudent(uid,'roster-check-C');
  }
  as('t1');let roster=await page('enrollments',[['offeringId','==','roster-check-C'],['teacherId','==','t1'],['active','==',true]]);
  assert.equal(roster.rows.length,2);
  const offering={...(await getDoc(doc(db('t1'),'offerings','roster-check-C'))).data(),id:'roster-check-C'};
  await saveMarks(roster.rows.find(e=>e.studentId==='rosterA'),offering,{ia1:20},'t1');
  await saveMarks(roster.rows.find(e=>e.studentId==='rosterB'),offering,{ia1:25},'t1');
  await saveMarks(roster.rows.find(e=>e.studentId==='rosterA'),offering,{ia1:29},'t1');
  assert.equal((await getDoc(doc(db('rosterB'),'marks','rosterB__roster-check-C'))).data().scores.ia1,25);
  await assertFails(getDoc(doc(db('rosterA'),'marks','rosterB__roster-check-C')));
  as('a1');await saveAccount({uid:'rosterLater',role:'student',name:'Later',email:'later@test.com',usn:'USNlater',semester:6,section:'C',mentorId:'m1'});await enrollStudent('rosterLater','roster-check-C');
  as('t1');roster=await page('enrollments',[['offeringId','==','roster-check-C'],['teacherId','==','t1'],['active','==',true]]);
  assert.equal(roster.rows.length,3);assert.ok(roster.rows.every(e=>e.section==='C'));
  await assertFails(getDoc(doc(db('t2'),'enrollments','rosterA__roster-check-C')));
});
