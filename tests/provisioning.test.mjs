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

test('teacher CSV validates required fields, staff roles, duplicates and identity conflicts',async()=>{
  await login(`${prefix}-admin@demo.test`);
  const row={name:'Synthetic teacher',collegeEmail:`${prefix}-csv-teacher@demo.test`,department:'ISE',employeeId:`${prefix}-CSV`,phone:'0000000000',role:'subject_faculty'};
  assert.equal(parseCSV('name,collegeEmail,phone,department,employeeId,role\nTeacher,test@demo.test,,ISE,F01,subject_faculty',['name','collegeEmail','phone','department','employeeId','role']).length,1);
  for(const field of ['name','collegeEmail','department','employeeId','role'])assert.equal((await api('previewTeachers',{rows:[{...row,[field]:''}]})).errors,1,field);
  for(const role of ['student','admin','unknown'])assert.equal((await api('previewTeachers',{rows:[{...row,role}]})).errors,1);
  assert.equal((await api('previewTeachers',{rows:[{...row,collegeEmail:'invalid'}]})).errors,1);
  for(const pair of [[row,{...row,employeeId:'different'}],[row,{...row,collegeEmail:`${prefix}-other@demo.test`}],[row,{...row,collegeEmail:row.collegeEmail.toUpperCase()}]]) {
    const duplicate=await api('previewTeachers',{rows:pair});assert.equal(duplicate.errors,2);assert.equal(duplicate.duplicates,2);
  }
  const unmanaged=await server.auth.createUser({email:`${prefix}-unmanaged@demo.test`,password:'DemoPassword123!'});
  await assert.rejects(api('importTeacher',{row:{...row,collegeEmail:unmanaged.email}}),e=>e.code==='functions/already-exists');
  await assert.rejects(api('importTeacher',{row:{...row,collegeEmail:created[0].email}}),e=>e.code==='functions/already-exists');
  await signOut(auth);await assert.rejects(api('previewTeachers',{rows:[row]}),e=>e.code==='functions/unauthenticated');
  await login(`${prefix}-mentor@demo.test`);await assert.rejects(api('importTeacher',{row}),e=>e.code==='functions/permission-denied');
  await login(`${prefix}-admin@demo.test`);
});

test('teacher import recovers interrupted Auth creation and concurrent same-row retries',async()=>{
  await login(`${prefix}-admin@demo.test`);
  const row={name:'Interrupted teacher',collegeEmail:`${prefix}-interrupted-teacher@demo.test`,phone:'',department:'ISE',employeeId:`${prefix}-INTERRUPTED`,role:'subject_faculty'};
  let interrupt=true;
  const guardedAuth=new Proxy(server.auth,{get(target,key){if(key==='createUser')return async options=>{const user=await target.createUser(options);if(interrupt){interrupt=false;throw new Error('Synthetic interruption after Auth creation');}return user;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const service=createProvisioner({db:server.db,auth:guardedAuth,demo:true});
  await assert.rejects(service.dispatch(ids.admin,{action:'importTeacher',row}),/Synthetic interruption/);
  const authUser=await server.auth.getUserByEmail(row.collegeEmail);assert.equal((await server.db.doc(`users/${authUser.uid}`).get()).exists,false);
  assert.equal((await api('previewTeachers',{rows:[row]})).warnings,1);
  const repaired=await api('importTeacher',{row});assert.equal(repaired.uid,authUser.uid);assert.equal((await server.db.doc(`users/${authUser.uid}`).get()).data().role,'subject_faculty');
  const concurrent={...row,collegeEmail:`${prefix}-concurrent-teacher@demo.test`,employeeId:`${prefix}-CONCURRENT`};
  const responses=await Promise.all([api('importTeacher',{row:concurrent}),api('importTeacher',{row:concurrent})]);assert.equal(responses[0].uid,responses[1].uid);
  assert.equal((await server.db.collection('users').where('email','==',concurrent.collegeEmail).get()).size,1);
});

test('six imported teachers login, resolve offerings, isolate A/B/C rosters and preserve independent marks on repeat imports',async()=>{
  await login(`${prefix}-admin@demo.test`);
  const teacherRows=Array.from({length:6},(_,i)=>({name:`CSV Teacher ${i+1}`,collegeEmail:`${prefix}-teacher-csv${i}@demo.test`,phone:'0000000000',department:'ISE',employeeId:`${prefix}-FAC${i}`,role:'subject_faculty'}));
  assert.equal((await api('previewTeachers',{rows:teacherRows})).valid,6);
  const teachers=[];for(const row of teacherRows)teachers.push(await api('importTeacher',{row}));
  const offers=[];
  for(let i=0;i<6;i++) {
    const row={...syntheticOffering(['A','A','B','B','C','C'][i],teacherRows[i].collegeEmail),semester:9,subjectCode:['BCS501','BCS502','BCS501','BCS503','BCS502','BCS503'][i]};
    assert.equal((await api('previewOfferings',{rows:[row]})).valid,1);
    offers.push({row,...await api('importOffering',{row})});
  }
  const pupils=[];
  for(let i=0;i<6;i++)pupils.push(await api('provision',{row:{...rows[i],semester:9,section:['A','A','B','B','C','C'][i],usn:`TEACH${Date.now()}${i}`,collegeEmail:`${prefix}-teacher-pupil${i}@demo.test`},requestId:`${prefix}-teacher-pupil${i}`}));
  let preserved;
  for(let i=0;i<6;i++) {
    assert.equal(await login(teacherRows[i].collegeEmail),teachers[i].uid);
    const classes=await page('offerings',[['teacherId','==',teachers[i].uid]]);assert.equal(classes.rows.length,1);assert.equal(classes.rows[0].id,offers[i].id);
    const roster=await page('enrollments',[['offeringId','==',offers[i].id],['teacherId','==',teachers[i].uid],['active','==',true]]);assert.equal(roster.rows.length,2);assert.ok(roster.rows.every(r=>r.section===offers[i].row.section&&r.semester===9));
    if(i===0) {
      await saveMarks(roster.rows[0],classes.rows[0],{ia1:19,assignment:6},teachers[i].uid);await saveMarks(roster.rows[1],classes.rows[0],{ia1:27,assignment:9},teachers[i].uid);
      preserved=await Promise.all(roster.rows.map(async r=>[r.id,(await server.db.doc(`marks/${r.id}`).get()).data()]));
      await assert.rejects(getDoc(doc(db,'students',pupils[2].uid)),e=>e.code==='permission-denied');
    }
  }
  await login(`${prefix}-admin@demo.test`);
  await server.db.doc(`users/${teachers[0].uid}`).set({customNote:'Keep this field',scheme:'2022'},{merge:true});
  await server.auth.updateUser(teachers[0].uid,{password:'PreservedTeacherPassword456!'});
  assert.equal((await api('previewTeachers',{rows:teacherRows})).warnings,6);
  for(let repeat=0;repeat<2;repeat++)for(let i=0;i<6;i++) {
    const result=await api('importTeacher',{row:{...teacherRows[i],name:`Updated CSV Teacher ${i+1}`}});assert.equal(result.uid,teachers[i].uid);assert.equal(result.accountCreated,false);assert.equal(result.activation,'unchanged');
    assert.equal((await api('importOffering',{row:offers[i].row})).id,offers[i].id);
    assert.equal((await server.db.collection('users').where('email','==',teacherRows[i].collegeEmail).get()).size,1);
  }
  for(const [id,marks] of preserved)assert.deepEqual((await server.db.doc(`marks/${id}`).get()).data(),marks);
  const profile=(await server.db.doc(`users/${teachers[0].uid}`).get()).data();assert.equal(profile.customNote,'Keep this field');assert.equal(profile.scheme,'2022');assert.equal(profile.offeringIds,undefined);assert.equal(profile.password,undefined);
  assert.equal(await login(teacherRows[0].collegeEmail,'PreservedTeacherPassword456!'),teachers[0].uid);
  await login(`${prefix}-admin@demo.test`);
  await assert.rejects(api('importTeacher',{row:{...teacherRows[0],employeeId:'changed'}}),e=>e.code==='functions/already-exists');
  await assert.rejects(api('importTeacher',{row:{...teacherRows[0],role:'hod'}}),e=>e.code==='functions/already-exists');
  await assert.rejects(api('importTeacher',{row:{...teacherRows[1],collegeEmail:`${prefix}-different-email@demo.test`}}),e=>e.code==='functions/already-exists');
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
  const teacher={role:'subject_faculty',name:'Production teacher path',collegeEmail:`${prefix}-prod-teacher@college.invalid`,department:'ISE',employeeId:`${prefix}-prod-teacher`,phone:''};
  const imported=await service.dispatch(ids.admin,{action:'importTeacher',row:teacher});assert.equal(imported.activation,'delivery-failed');assert.equal(imported.demoPassword,undefined);
  assert.equal((await server.db.doc(`users/${imported.uid}`).get()).data().password,undefined);
  assert.ok(!JSON.stringify((await server.db.doc(`provisioningJobs/${imported.uid}`).get()).data()).includes('DemoPassword123!'));
  const repeated=await service.dispatch(ids.admin,{action:'importTeacher',row:teacher});assert.equal(repeated.uid,imported.uid);assert.equal(repeated.activation,'unchanged');assert.equal(repeated.demoPassword,undefined);
  await assert.rejects(login(teacher.collegeEmail),e=>['auth/invalid-credential','auth/wrong-password'].includes(e.code));
});
