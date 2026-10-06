// Real emulator sign-ins and client-rule checks; never loads production config.
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword,signOut} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDoc,collection,getDocs} from 'firebase/firestore';
import {useContext} from './runtime.mjs';
import {academicDetails,saveMarks} from '../js/academic.js';
const app=initializeApp({apiKey:'fake-api-key',projectId:'demo-digital-no-due'},'verify-demo');
const auth=getAuth(app),db=getFirestore(app);
connectAuthEmulator(auth,'http://127.0.0.1:9199',{disableWarnings:true});
connectFirestoreEmulator(db,'127.0.0.1',8180);
const ids={};
const roles=['admin','student','subject_faculty','mentor','hod','office','library','physics_lab','chemistry_lab','accounts','java_faculty','os_faculty','student2'];
async function login(key) {
  const credential=await signInWithEmailAndPassword(auth,`${key}@demo.test`,'DemoPassword123!');
  useContext(db,credential.user.uid);
  return credential.user.uid;
}
try {
  for(const role of roles) {
    ids[role]=await login(role);
    const user=(await getDoc(doc(db,'users',ids[role]))).data();
    assert.equal(user.role,['java_faculty','os_faculty'].includes(role)?'subject_faculty':role==='student2'?'student':role);
    console.log(`PASS login/profile: ${role}@demo.test (${user.role})`);
  }
  await login('student');
  const details=await academicDetails(ids.student);
  assert.equal(details.student.semester,5); assert.equal(details.student.section,'C');
  assert.equal(details.student.usn,'DEMO5C001'); assert.equal(details.mentor.id,ids.mentor);
  assert.equal(details.subjects.length,3);
  for(const subject of details.subjects) {
    assert.ok(subject.teacher); assert.equal(subject.assignments.length,1);
    assert.ok(subject.marks.scores.ia1>=0); assert.ok(subject.marks.scores.ia2>=0); assert.ok(subject.marks.scores.assignment>=0);
  }
  const plan=(await getDoc(doc(db,'students',ids.student,'clearance','plan'))).data();
  assert.equal(plan.valid,true); assert.equal(Object.keys(plan.items).length,7);
  assert.equal(plan.mentorId,ids.mentor); assert.equal(plan.hodId,ids.hod); assert.equal(plan.officeId,ids.office);
  console.log('PASS Semester 5 C profile, mentor, 3 subjects/teachers/marks/assignments, 7 Stage 1 mappings and later-stage mappings');
  const subject=details.subjects.find(s=>s.offering.subjectCode==='CS501');
  const original=subject.marks.scores;
  await login('subject_faculty');
  try {
    await saveMarks(subject.enrollment,subject.offering,{...original,ia1:23},ids.subject_faculty);
    await login('student');
    assert.equal((await getDoc(doc(db,'marks',subject.enrollment.id))).data().scores.ia1,23);
    console.log('PASS assigned teacher marks update and student read');
  } finally {
    await login('subject_faculty');
    await saveMarks(subject.enrollment,subject.offering,original,ids.subject_faculty);
  }
  await login('student2');
  const second=await academicDetails(ids.student2);
  assert.equal(second.student.usn,'DEMO5C002'); assert.equal(second.subjects.length,3);
  await getDocs(collection(db,'users',ids.student2,'notifications'));
  await assert.rejects(getDocs(collection(db,'users',ids.student,'notifications')),error=>error.code==='permission-denied');
  console.log('PASS second student has own academic data; cannot read first student notifications');
  console.log('Demo verification passed. Original marks restored; no No-Due request created.');
} finally {await signOut(auth); await deleteApp(app);}
