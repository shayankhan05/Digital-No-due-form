// Emulator-only fixtures. No production config, credentials or Admin SDK are loaded.
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,writeBatch} from 'firebase/firestore';
import {useContext} from './runtime.mjs';
import {saveAccount,saveOffering,enrollStudent} from '../js/admin-data.js';
import {record,saveMarks} from '../js/academic.js';
const projectId='demo-digital-no-due';
const password='DemoPassword123!';
for (const [key,expected] of Object.entries({FIRESTORE_EMULATOR_HOST:'127.0.0.1:8180',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9199',GCLOUD_PROJECT:projectId,GOOGLE_CLOUD_PROJECT:projectId})) {
  if(process.env[key] && process.env[key]!==expected) throw new Error(`Refusing unexpected ${key}; expected ${expected}.`);
}
const roles=['admin','student','subject_faculty','mentor','hod','office','library','physics_lab','chemistry_lab','accounts'];
const accounts=[...roles.map(key=>({key,role:key})),{key:'java_faculty',role:'subject_faculty'},{key:'os_faculty',role:'subject_faculty'},{key:'student2',role:'student'}];
const subjects=[
  {id:'demo-dbms',name:'Database Management Systems',code:'CS501',teacher:'subject_faculty',scores:{ia1:22,ia2:24,assignment:8},title:'SQL joins and aggregates',description:'Write SQL queries using joins, grouping and aggregate functions.'},
  {id:'demo-java',name:'Java Programming',code:'CS502',teacher:'java_faculty',scores:{ia1:21,ia2:23,assignment:7},title:'Java inheritance exercise',description:'Implement a class hierarchy with inheritance and method overriding.'},
  {id:'demo-os',name:'Operating Systems',code:'CS503',teacher:'os_faculty',scores:{ia1:25,ia2:26,assignment:9},title:'CPU scheduling exercise',description:'Compare FCFS and round-robin scheduling with turnaround and waiting times.'}
];
const components=[{id:'ia1',label:'Internal Assessment 1',max:30},{id:'ia2',label:'Internal Assessment 2',max:30},{id:'assignment',label:'Assignment',max:10}];
const environment=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8180}});
const ids={};
async function authRequest(method,email) {
  const response=await fetch(`http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:${method}?key=fake-api-key`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  return {ok:response.ok,body:await response.json()};
}
try {
  for(const account of accounts) {
    const email=`${account.key}@demo.test`;
    let result=await authRequest('signUp',email);
    if(!result.ok && result.body.error?.message==='EMAIL_EXISTS') result=await authRequest('signInWithPassword',email);
    if(!result.ok) throw new Error(`${email}: ${result.body.error?.message}. No existing password is changed.`);
    ids[account.key]=result.body.localId;
  }
  await environment.withSecurityRulesDisabled(async c=>{
    const store=c.firestore();
    for(const account of accounts) {
      const existing=await getDoc(doc(store,'users',ids[account.key]));
      if(existing.exists() && (existing.data().email!==`${account.key}@demo.test` || existing.data().role!==account.role)) throw new Error(`Conflicting profile for ${account.key}; seed aborted.`);
    }
    const batch=writeBatch(store);
    for(const account of accounts) batch.set(doc(store,'users',ids[account.key]),{name:`Demo ${account.key.replaceAll('_',' ')}`,email:`${account.key}@demo.test`,phone:'0000000000',facultyId:account.role==='student'?'':`DEMO-${account.key}`,department:'Computer Science',role:account.role,demoSeed:'semester-5-C'},{merge:true});
    await batch.commit();
  });
  const store=environment.authenticatedContext(ids.admin).firestore();
  useContext(store,ids.admin);
  await setDoc(doc(store,'settings','workflow'),{...Object.fromEntries(['library','physics_lab','chemistry_lab','accounts'].map(k=>[k,ids[k]])),hodId:ids.hod,officeId:ids.office});
  for(const key of ['student','student2']) {
    await saveAccount({uid:ids[key],role:'student',name:key==='student'?'Asha Demo':'Ravi Demo',email:`${key}@demo.test`,phone:'0000000000',department:'Computer Science',usn:key==='student'?'DEMO5C001':'DEMO5C002',semester:5,section:'C',mentorId:ids.mentor});
    const old=doc(store,'enrollments',`${ids[key]}__dbms-6-C`);
    if((await getDoc(old)).exists()) await setDoc(old,{active:false},{merge:true});
  }
  for(const subject of subjects) {
    useContext(store,ids.admin);
    const offeringId=`${subject.id}-5-C`;
    await setDoc(doc(store,'subjects',subject.id),{name:subject.name,code:subject.code});
    await saveOffering({id:offeringId,subjectId:subject.id,semester:5,section:'C',teacherId:ids[subject.teacher],components});
    await setDoc(doc(store,'assignments',`${subject.id}-assignment`),{offeringId,title:subject.title,description:subject.description,dueDate:'2026-10-10',status:'Assigned'});
    for(const key of ['student','student2']) {
      await enrollStudent(ids[key],offeringId);
      const enrollment=await record('enrollments',`${ids[key]}__${offeringId}`);
      const offering=await record('offerings',offeringId);
      useContext(environment.authenticatedContext(ids[subject.teacher]).firestore(),ids[subject.teacher]);
      await saveMarks(enrollment,offering,subject.scores,ids[subject.teacher]);
      useContext(store,ids.admin);
    }
  }
  console.log(`Seed complete: ${projectId}, Auth 127.0.0.1:9199, Firestore 127.0.0.1:8180.`);
  console.log(`Password for every demo account: ${password}`);
  for(const account of accounts) console.log(`${account.role.padEnd(16)} ${account.key}@demo.test  UID=${ids[account.key]}`);
  console.log('Students DEMO5C001 / DEMO5C002: Semester 5, Section C; 3 subjects, marks, assignments and 7 Stage 1 mappings each.');
  console.log('Rerunning resets known demo academic fixtures; existing requests/notifications are preserved.');
  console.log('Open http://127.0.0.1:5050/login.html?emulator=1');
} finally {await environment.cleanup();}
