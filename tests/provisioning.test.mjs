import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword,signOut,sendPasswordResetEmail,verifyPasswordResetCode,confirmPasswordReset,EmailAuthProvider,reauthenticateWithCredential,updatePassword} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDoc,getDocs,collection,query,where} from 'firebase/firestore';
import {getFunctions,connectFunctionsEmulator,httpsCallable} from 'firebase/functions';
import {localAdmin,bootstrapFixture,studentRows,syntheticOffering} from './bulk-fixture.mjs';
import {useContext} from './runtime.mjs';
import {page,academicDetails,saveMarks} from '../js/academic.js';
import {submitRequest,getRequiredApprovers} from '../js/workflow.js';
import {parseCSV} from '../js/csv.js';
import {createProvisioner} from '../functions/provisioning.js';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const {deleteApp:deleteAdminApp}=require('firebase-admin/app');
const projectId=process.env.TEST_PROJECT_ID || 'demo-digital-no-due-audit';
if(projectId!=='demo-digital-no-due-audit') throw new Error('Provisioning tests run only in the isolated audit project.');
let server,app,auth,db,api,ids,rows,created=[],offeringId;
const prefix=`bulk-${Date.now()}`;
async function login(email,password='DemoPassword123!') {const credential=await signInWithEmailAndPassword(auth,email,password);useContext(db,credential.user.uid);return credential.user.uid;}
before(async()=>{
  server=localAdmin(projectId,8181,9200);ids=await bootstrapFixture(server,prefix);rows=studentRows(prefix);
  app=initializeApp({apiKey:'fake-api-key',projectId},`provision-${prefix}`);auth=getAuth(app);db=getFirestore(app);
  connectAuthEmulator(auth,'http://127.0.0.1:9200',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8181);
  const functions=getFunctions(app,'us-central1');connectFunctionsEmulator(functions,'127.0.0.1',5002);const callable=httpsCallable(functions,'institutionalAdmin',{timeout:540000});
  api=async(action,data={})=>(await callable({action,...data})).data;
  await login(`${prefix}-admin@demo.test`);
});
after(async()=>{if(app)await deleteApp(app);if(server)await deleteAdminApp(server.app);});
test('callable backend denies anonymous and non-admin callers',async()=>{
  await signOut(auth);await assert.rejects(api('policy'),e=>e.code==='functions/unauthenticated');
  await login(`${prefix}-mentor@demo.test`);await assert.rejects(api('policy'),e=>e.code==='functions/permission-denied');
  await login(`${prefix}-admin@demo.test`);
});
test('CSV validation, missing faculty, duplicate rows, invalid domain and mentor',async()=>{
  assert.equal(parseCSV('name,usn,collegeEmail\n"Example, Student",1AY24IS101,test@demo.test',['name','usn','collegeEmail'])[0].name,'Example, Student');
  assert.throws(()=>parseCSV('name,name\na,b',[]));assert.throws(()=>parseCSV('name,usn\na',[]));
  const result=await api('previewAccounts',{rows:[rows[0],rows[0],{...rows[1],collegeEmail:'x@unauthorized.test'},{...rows[2],mentorEmail:'missing@demo.test'}]});
  assert.equal(result.errors,3);assert.equal(result.duplicates,1);
  const absent=await api('previewOfferings',{rows:[syntheticOffering('C','missing@demo.test')]});assert.equal(absent.errors,1);
});
test('provision staff, import offerings and bulk-create 50 students in three sections without UIDs',async()=>{
  const staff=await api('provision',{requestId:`${prefix}-staff`,row:{role:'subject_faculty',name:'Synthetic comparison teacher',collegeEmail:`${prefix}-teacher-ab@demo.test`,facultyId:`${prefix}-AB`,department:'ISE'}});
  for(const section of ['A','B','C']) {
    const row=syntheticOffering(section,section==='C'?`${prefix}-subject_faculty@demo.test`:staff.email);
    const checked=await api('previewOfferings',{rows:[row]});assert.equal(checked.valid,1);
    const result=await api('importOffering',{row});if(section==='C')offeringId=result.id;
  }
  const preview=await api('previewAccounts',{rows});assert.equal(preview.valid,50);assert.equal(preview.errors,0);
  for(let i=0;i<rows.length;i++) {
    const result=await api('provision',{row:rows[i],requestId:`${prefix}-${i}`});created.push(result);
    assert.equal(result.accountCreated,true);assert.equal(result.subjectsMapped,1);assert.equal(result.mentorMapped,true);
    assert.equal((await server.auth.getUser(result.uid)).email,rows[i].collegeEmail);
    assert.equal((await server.db.doc(`students/${result.uid}`).get()).data().section,rows[i].section);
    assert.equal((await server.db.doc(`students/${result.uid}/clearance/plan`).get()).data().valid,true);
    assert.ok(!JSON.stringify((await server.db.doc(`provisioningJobs/${result.uid}`).get()).data()).includes('DemoPassword123!'));
  }
  const retry=await api('provision',{row:rows[0],requestId:`${prefix}-0`});assert.equal(retry.uid,created[0].uid);
  await assert.rejects(api('provision',{row:{...rows[0],collegeEmail:`${prefix}-other@demo.test`},requestId:`${prefix}-duplicate-usn`}),e=>e.code==='functions/already-exists');
  const reimport=await api('provision',{row:rows[0],requestId:`${prefix}-duplicate-email`});assert.equal(reimport.uid,created[0].uid);assert.equal(reimport.accountCreated,false);
});
test('automatic class roster, isolated marks, mentor directory, own academic data and No-Due mappings',async()=>{
  await login(`${prefix}-subject_faculty@demo.test`);
  const roster=await page('enrollments',[['offeringId','==',offeringId],['teacherId','==',ids.subject_faculty],['active','==',true]]);
  assert.equal(roster.rows.length,16);assert.ok(roster.rows.every(r=>r.section==='C'));
  const outside=created[0];await assert.rejects(getDoc(doc(db,'students',outside.uid)),e=>e.code==='permission-denied');
  const first=roster.rows[0],second=roster.rows[1],offering={...(await getDoc(doc(db,'offerings',offeringId))).data(),id:offeringId};
  await saveMarks(first,offering,{ia1:20,assignment:7},ids.subject_faculty);await saveMarks(second,offering,{ia1:25,assignment:9},ids.subject_faculty);await saveMarks(first,offering,{ia1:29,assignment:8},ids.subject_faculty);
  assert.equal((await getDoc(doc(db,'marks',second.id))).data().scores.ia1,25);
  await login(created.find(s=>s.uid===first.studentId).email);const details=await academicDetails(first.studentId);assert.equal(details.subjects.length,1);assert.equal(details.subjects[0].marks.scores.ia1,29);
  await assert.rejects(getDoc(doc(db,'marks',second.id)),e=>e.code==='permission-denied');
  const id=await submitRequest();assert.equal((await getDoc(doc(db,'noDueRequests',id))).data().approvalItems[`subject_${offeringId}`].approverId,ids.subject_faculty);
  await login(`${prefix}-mentor@demo.test`);let total=0,cursor=null,more=true;while(more){const part=await page('students',[['mentorId','==',ids.mentor]],cursor);total+=part.rows.length;cursor=part.cursor;more=part.more;}assert.equal(total,50);
});
test('late offering import automatically maps already imported students with paginated class writes',async()=>{
  await login(`${prefix}-admin@demo.test`);
  const row={...syntheticOffering('C',`${prefix}-subject_faculty@demo.test`),subjectCode:'CS502',subjectName:'Java Programming'};
  await api('importOffering',{row});const mapped=await api('mapClass',{department:'ISE',scheme:'2022',semester:5,section:'C'});assert.equal(mapped.results.length,16);assert.ok(mapped.results.every(r=>r.subjectsMapped===2));
  const uid=created[2].uid;await login(created[2].email);assert.equal((await academicDetails(uid)).subjects.length,2);
});
test('CSV reimports repair legacy offering enrollment for A/B/C without duplicating or replacing marks',async()=>{
  await login(`${prefix}-admin@demo.test`);
  // Semester 6 belongs to the security suite's legacy fixtures. Use an empty
  // semester so this test can verify an actual zero-to-three repair.
  const repairRows=['A','B','C'].map((section,i)=>({...rows[i],semester:7,usn:`REPAIR${Date.now()}${i}`,collegeEmail:`${prefix}-repair-${section}@demo.test`}));
  const students=[];
  for(let i=0;i<repairRows.length;i++) {
    const result=await api('provision',{row:repairRows[i],requestId:`${prefix}-repair-${i}`});
    assert.equal(result.subjectsMapped,0);students.push(result);
  }
  for(const section of ['A','B','C']) {
    for(let i=0;i<3;i++) {
      const id=`${prefix}-legacy-${section}-${i}`;
      const offering={...syntheticOffering(section,`${prefix}-subject_faculty@demo.test`),semester:'7',department:'Information Science & Engineering',teacherId:ids.subject_faculty,subjectId:id,subjectCode:`REPAIR${i}`};
      delete offering.scheme;
      delete offering.active; // Exact legacy saveOffering/seed shape: no active flag.
      if(i===1) delete offering.department;
      await server.db.doc(`offerings/${id}`).set(offering);
    }
    for(const [suffix,extra] of [['inactive',{active:false}],['scheme',{scheme:'2021'}],['department',{department:'Other department'}]]) {
      await server.db.doc(`offerings/${prefix}-excluded-${section}-${suffix}`).set({...syntheticOffering(section,''),semester:7,teacherId:ids.subject_faculty,subjectId:'excluded',...extra});
    }
  }
  for(let i=0;i<students.length;i++) {
    const student=students[i],section=repairRows[i].section;
    // Completed jobs must re-query offerings, rather than returning the old zero count.
    assert.equal((await api('provision',{row:repairRows[i],requestId:`${prefix}-repair-${i}`})).subjectsMapped,3);
    let enrollments=await server.db.collection('enrollments').where('studentId','==',student.uid).get();
    assert.equal(enrollments.size,3);assert.ok(enrollments.docs.every(d=>d.data().section===section && d.data().studentId===student.uid));
    const original=enrollments.docs[0],customId=`${student.uid}__preserved-record`;
    await server.db.doc(`enrollments/${customId}`).set({...original.data(),customNote:'Keep this enrollment'});await original.ref.delete();
    const savedMarks={studentId:student.uid,offeringId:original.data().offeringId,teacherId:ids.subject_faculty,mentorId:ids.mentor,scores:{ia1:24,assignment:8}};
    await server.db.doc(`marks/${customId}`).set(savedMarks);
    const preview=await api('previewAccounts',{rows:[repairRows[i]]});assert.equal(preview.errors,0);
    for(let repeat=0;repeat<2;repeat++) {
      const result=await api('provision',{row:repairRows[i],requestId:`${prefix}-new-import-${i}-${repeat}`});
      assert.equal(result.uid,student.uid);assert.equal(result.accountCreated,false);assert.equal(result.subjectsMapped,3);
    }
    enrollments=await server.db.collection('enrollments').where('studentId','==',student.uid).get();assert.equal(enrollments.size,3);
    assert.equal((await server.db.doc(`enrollments/${customId}`).get()).data().customNote,'Keep this enrollment');
    assert.deepEqual((await server.db.doc(`marks/${customId}`).get()).data(),savedMarks);
    const profile=(await server.db.doc(`students/${student.uid}`).get()).data();assert.equal(profile.offeringIds.length,3);
    const plan=(await server.db.doc(`students/${student.uid}/clearance/plan`).get()).data();assert.equal(plan.valid,true);assert.equal(Object.keys(plan.items).length,7);
    await login(student.email);const details=await academicDetails(student.uid);assert.equal(details.subjects.length,3);assert.ok(details.subjects.every(s=>s.offering.section===section));
    const dashboardSubjects=(await getRequiredApprovers(student.uid)).filter(item=>item.approverType==='subject_faculty');assert.equal(dashboardSubjects.length,3);
    assert.equal(details.subjects.find(s=>s.enrollment.id===customId).marks.scores.ia1,24);
    await login(`${prefix}-subject_faculty@demo.test`);
    for(const offeringId of profile.offeringIds) {
      const roster=await page('enrollments',[['offeringId','==',offeringId],['teacherId','==',ids.subject_faculty],['active','==',true]]);
      assert.equal(roster.rows.length,1);assert.equal(roster.rows[0].studentId,student.uid);
    }
    await login(`${prefix}-admin@demo.test`);
  }
});

test('fully scoped offerings supersede legacy fallbacks without deleting enrollments or marks',async()=>{
  await login(`${prefix}-admin@demo.test`);
  const row={...rows[0],semester:8,section:'C',usn:`SCOPE${Date.now()}`,collegeEmail:`${prefix}-scope@demo.test`};
  const legacyId=`${prefix}-unscoped-8-C`;
  await server.db.doc(`offerings/${legacyId}`).set({subjectId:legacyId,subjectCode:'OLD',subjectName:'Legacy fallback',semester:8,section:'C',teacherId:ids.subject_faculty,components:[{id:'ia1',label:'Internal',max:30}]});
  const student=await api('provision',{row,requestId:`${prefix}-scope-first`});assert.equal(student.subjectsMapped,1);
  const legacyEnrollment=`${student.uid}__${legacyId}`,oldMarks={studentId:student.uid,offeringId:legacyId,teacherId:ids.subject_faculty,mentorId:ids.mentor,scores:{ia1:23}};
  await server.db.doc(`marks/${legacyEnrollment}`).set(oldMarks);
  for(let i=0;i<3;i++)await api('importOffering',{row:{...syntheticOffering('C',`${prefix}-subject_faculty@demo.test`),semester:8,subjectCode:`SCOPED${i}`,subjectName:`Scoped subject ${i}`}});
  for(let retry=0;retry<2;retry++)assert.equal((await api('provision',{row,requestId:`${prefix}-scope-retry-${retry}`})).subjectsMapped,3);
  const all=await server.db.collection('enrollments').where('studentId','==',student.uid).get();assert.equal(all.size,4);assert.equal(all.docs.filter(d=>d.data().active===true).length,3);
  assert.equal((await server.db.doc(`enrollments/${legacyEnrollment}`).get()).data().active,false);
  assert.deepEqual((await server.db.doc(`marks/${legacyEnrollment}`).get()).data(),oldMarks);
  await login(student.email);assert.equal((await academicDetails(student.uid)).subjects.length,3);assert.equal((await getRequiredApprovers(student.uid)).filter(i=>i.type==='subject_faculty').length,3);
});

test('Firebase forgot password and reauthenticated change password work in the emulator',async()=>{
  const target=created[1];await signOut(auth);await sendPasswordResetEmail(auth,target.email);
  const response=await fetch(`http://127.0.0.1:9200/emulator/v1/projects/${projectId}/oobCodes`);assert.equal(response.ok,true);
  const codes=(await response.json()).oobCodes || [];const code=codes.filter(c=>c.email===target.email && c.requestType==='PASSWORD_RESET').at(-1);assert.ok(code);
  assert.equal(await verifyPasswordResetCode(auth,code.oobCode),target.email);await confirmPasswordReset(auth,code.oobCode,'ResetDemoPassword456!');
  await login(target.email,'ResetDemoPassword456!');await reauthenticateWithCredential(auth.currentUser,EmailAuthProvider.credential(target.email,'ResetDemoPassword456!'));await updatePassword(auth.currentUser,'ChangedDemoPassword789!');
  await signOut(auth);await login(target.email,'ChangedDemoPassword789!');
  // Restore only the synthetic test account so the professor demo credentials remain simple.
  await server.auth.updateUser(target.uid,{password:'DemoPassword123!'});
});
test('production branch never issues demo passwords and reports activation delivery failure honestly',async()=>{
  await server.db.doc('settings/institution').set({allowedDomains:['college.invalid'],departments:['ISE'],sections:['A','B','C']},{merge:true});
  const service=createProvisioner({db:server.db,auth:server.auth,demo:false,sendActivation:async()=>{throw new Error('simulated SMTP failure');}});
  const row={role:'office',name:'Synthetic production-path test',collegeEmail:`${prefix}@college.invalid`,department:'ISE',facultyId:`${prefix}-production`};
  const result=await service.dispatch(ids.admin,{action:'provision',row,requestId:`${prefix}-production`});assert.equal(result.activation,'delivery-failed');assert.equal(result.demoPassword,undefined);
  const profile=(await server.db.doc(`users/${result.uid}`).get()).data();assert.equal(profile.password,undefined);
  const rejected=await service.dispatch(ids.admin,{action:'previewAccounts',rows:[{...row,collegeEmail:'x@demo.test'}]});assert.equal(rejected.rows[0].status,'ERROR');
});
