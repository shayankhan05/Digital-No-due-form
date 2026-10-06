// Trusted emulator-only demonstration helper; no live Firebase configuration is imported.
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {createProvisioner} from '../functions/provisioning.js';
import {localAdmin} from './bulk-fixture.mjs';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const {deleteApp}=require('firebase-admin/app');
for(const [key,value] of Object.entries({GCLOUD_PROJECT:'demo-digital-no-due',GOOGLE_CLOUD_PROJECT:'demo-digital-no-due',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8180',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9199'})) if(process.env[key] && process.env[key]!==value) throw new Error(`Refusing unexpected ${key}.`);
const server=localAdmin('demo-digital-no-due',8180,9199);
try {
  const admin=await server.auth.getUserByEmail('admin@demo.test'),service=createProvisioner({db:server.db,auth:server.auth,demo:true});
  const api=(action,data={})=>service.dispatch(admin.uid,{action,...data});
  const staffEmail='ise-ab-faculty@demo.test';
  let ab;try{ab=await server.auth.getUserByEmail(staffEmail);}catch(error){if(error.code!=='auth/user-not-found')throw error;const result=await api('provision',{requestId:'ise-demo-ab-faculty-v1',row:{role:'subject_faculty',name:'Demo A/B Faculty',collegeEmail:staffEmail,facultyId:'ISE-DEMO-AB',department:'ISE'}});ab={uid:result.uid};}
  if((await server.db.doc(`users/${ab.uid}`).get()).data()?.role!=='subject_faculty') throw new Error('Conflicting synthetic A/B faculty profile.');
  const subjects=[['CS501','Database Management Systems','subject_faculty@demo.test'],['CS502','Java Programming','java_faculty@demo.test'],['CS503','Operating Systems','os_faculty@demo.test']];
  for(const section of ['A','B','C']) for(const [subjectCode,subjectName,teacher] of subjects) {
    const row={department:'ISE',scheme:'2022',semester:5,section,subjectCode,subjectName,teacherEmail:section==='C'?teacher:staffEmail,credits:'',active:true,components:[{id:'ia1',label:'Internal Assessment 1',max:30},{id:'ia2',label:'Internal Assessment 2',max:30},{id:'assignment',label:'Assignment',max:10}]};
    const {id}=await api('importOffering',{row});
    await server.db.doc(`assignments/${id}_demo`).set({offeringId:id,title:'Synthetic demonstration assignment',description:'Demo-only assignment notice; this is not timetable source data.',dueDate:'2026-10-10',status:'Assigned'},{merge:true});
  }
  const rows=Array.from({length:50},(_,i)=>({name:`Synthetic ISE Student ${i+1}`,usn:`1AY24IS${101+i}`,collegeEmail:`ise-demo-1ay24is${101+i}@demo.test`,phone:'0000000000',department:'ISE',semester:5,section:['A','B','C'][i%3],scheme:'2022',mentorEmail:'mentor@demo.test'}));
  const report=[];
  for(let i=0;i<rows.length;i++) {
    const row=rows[i];
    try {
      let existing;try{existing=await server.auth.getUserByEmail(row.collegeEmail);}catch(error){if(error.code!=='auth/user-not-found')throw error;}
      if(existing) {
        const student=(await server.db.doc(`students/${existing.uid}`).get()).data();
        if(!student || student.usn!==row.usn || student.department!=='ISE' || student.scheme!=='2022' || student.semester!==5 || student.section!==row.section) throw new Error('Existing demo identity needs administrative review; no profile was overwritten.');
        report.push({...row,uid:existing.uid,accountCreated:false,error:'',status:'Existing account preserved'});
      } else report.push({...row,...await api('provision',{row,requestId:`ise-demo-student-${101+i}-v1`}),error:''});
    } catch(error) {report.push({...row,error:error.message});}
    console.log(`${i+1}/50 ${row.usn} ${report.at(-1).error || 'ready'}`);
  }
  const headers=['name','usn','collegeEmail','phone','department','semester','section','scheme','mentorEmail'];
  const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  await writeFile(new URL('../templates/demo-students-50.csv',import.meta.url),[headers.join(','),...rows.map(r=>headers.map(k=>quote(r[k])).join(','))].join('\r\n'));
  await writeFile(new URL('bulk-demo-results.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(`Bulk demo: ${report.filter(r=>!r.error).length}/50 ready. All local passwords: DemoPassword123!`);
  console.log('C: 1AY24IS103, 106, 109 … 148. A/B faculty: ise-ab-faculty@demo.test. C teachers: existing three demo faculty accounts.');
  console.log('Synthetic demo offerings preserve CS501/CS502/CS503 fixture; they do not assert timetable faculty mappings.');
  if(report.some(r=>r.error))process.exitCode=1;
} finally {await deleteApp(server.app);}
