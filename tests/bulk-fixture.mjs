// Only emulator bootstrap/test data. Real timetable faculty are deliberately not inferred.
import {createRequire} from 'node:module';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
export function localAdmin(projectId,firestorePort,authPort) {
  if(!projectId.startsWith('demo-') || ![8180,8181].includes(firestorePort) || ![9199,9200].includes(authPort)) throw new Error('Bulk fixtures require the known demo emulators.');
  process.env.FIRESTORE_EMULATOR_HOST=`127.0.0.1:${firestorePort}`;process.env.FIREBASE_AUTH_EMULATOR_HOST=`127.0.0.1:${authPort}`;
  const app=initializeApp({projectId},`bulk-${Date.now()}`);return {app,auth:getAuth(app),db:getFirestore(app)};
}
export async function bootstrapFixture(server,prefix) {
  const roles=['admin','mentor','hod','office','subject_faculty','library','physics_lab','chemistry_lab','accounts'];
  const ids={};
  for(const role of roles) {
    const email=`${prefix}-${role}@demo.test`;
    let user;try {user=await server.auth.getUserByEmail(email);}catch(error){if(error.code!=='auth/user-not-found') throw error;user=await server.auth.createUser({email,password:'DemoPassword123!',displayName:`Demo ${role}`});}
    ids[role]=user.uid;
    await server.db.doc(`users/${user.uid}`).set({name:`Demo ${role}`,email,role,department:'ISE',facultyId:`${prefix}-${role}`,phone:'0000000000'},{merge:true});
  }
  await server.db.doc('settings/workflow').set({...Object.fromEntries(['library','physics_lab','chemistry_lab','accounts'].map(role=>[role,ids[role]])),hodId:ids.hod,officeId:ids.office});
  return ids;
}
export function studentRows(prefix) {
  return Array.from({length:50},(_,i)=>({name:`Synthetic ISE Student ${i+1}`,usn:`1AY24IS${101+i}`,collegeEmail:`${prefix}-student${101+i}@demo.test`,phone:'0000000000',department:'ISE',semester:5,section:['A','B','C'][i%3],scheme:'2022',mentorEmail:`${prefix}-mentor@demo.test`}));
}
export function syntheticOffering(section,teacherEmail) {
  return {department:'ISE',scheme:'2022',semester:5,section,subjectCode:'CS501',subjectName:'Database Management Systems',teacherEmail,credits:'',components:[{id:'ia1',label:'Internal Assessment 1',max:30},{id:'assignment',label:'Assignment',max:10}],active:true};
}
