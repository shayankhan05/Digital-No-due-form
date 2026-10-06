import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {localAdmin,bootstrapFixture} from './bulk-fixture.mjs';
import {assertAuditTarget,launchAuditBrowser} from './audit-browser-runtime.mjs';
import {searchOfficeStudents,syncOfficeSearchIndex,officeStatus} from '../functions/office-search.js';
import {createRequire} from 'node:module';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,setDoc} from 'firebase/firestore';
assertAuditTarget();const server=localAdmin('demo-digital-no-due-audit',8181,9200),prefix=`office-search-${Date.now()}`;let ids,app,db,browser;
const search=(term,filters={},cursor=null)=>searchOfficeStudents(server.db,ids.office,{term,filters,cursor});
const students=[
  {uid:prefix+'-ayesha',name:'Ayesha Siddiqui',usn:'1AY99IS158',email:prefix+'-ayesha@demo.test',department:'ISE',semester:5,section:'C'},
  ...['A','B','C'].map((section,i)=>({uid:prefix+'-aarav'+i,name:'Aarav Sharma',usn:`1AY99IS${101+i}`,email:prefix+`-aarav${i}@demo.test`,department:i===2?'CSE':'ISE',semester:i===2?6:5,section})),
  {uid:prefix+'-meher',name:'Meher Fatima',usn:'1AY99IS161',email:prefix+'-meher@demo.test',department:'ISE',semester:5,section:'B'}
];
before(async()=>{
  ids=await bootstrapFixture(server,prefix);
  for(const student of students){await server.db.doc(`students/${student.uid}`).set(student);await syncOfficeSearchIndex(server.db,student.uid);}
  const ayesha=students[0];await server.db.doc(`noDueRequests/${prefix}-pending`).set({studentId:ayesha.uid,studentName:ayesha.name,usn:ayesha.usn,officeId:ids.office,status:'pending_stage1',createdAt:new Date(),approvalItems:{accounts:{approverType:'accounts'}},approvalStates:{accounts:'pending'}});
  const cleared=students[1];await server.db.doc(`noDueRequests/${prefix}-cleared`).set({studentId:cleared.uid,studentName:cleared.name,usn:cleared.usn,officeId:ids.office,status:'cleared',createdAt:new Date(),approvalItems:{},approvalStates:{},semester:5,section:'A'});
  const issued=students[2];await server.db.doc(`noDueRequests/${prefix}-issued`).set({studentId:issued.uid,studentName:issued.name,usn:issued.usn,officeId:ids.office,status:'issued',createdAt:new Date()});
  app=initializeApp({apiKey:'fake-api-key',projectId:'demo-digital-no-due-audit'},prefix);const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9200',{disableWarnings:true});db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8181);await signInWithEmailAndPassword(auth,`${prefix}-office@demo.test`,'DemoPassword123!');
});
after(async()=>{await browser?.close();if(app)await deleteApp(app);await server.app.delete();});
test('exact USN and UID searches return the student',async()=>{assert.equal((await search('1ay99is158')).rows[0].uid,students[0].uid);assert.equal((await search(students[0].uid)).rows[0].uid,students[0].uid);});
test('exact college email search is case insensitive',async()=>{assert.equal((await search(students[0].email.toUpperCase())).rows[0].uid,students[0].uid);});
test('full name search returns the expected student',async()=>{assert.equal((await search('Ayesha Siddiqui')).rows[0].uid,students[0].uid);});
test('partial surname and partial first name searches work',async()=>{assert.equal((await search('Sid')).rows[0].uid,students[0].uid);assert.equal((await search('Meh')).rows[0].uid,students[4].uid);});
test('name casing and excess whitespace do not change results',async()=>{for(const term of ['ayesha','AYESHA',' Ayesha   Siddiqui '])assert.equal((await search(term)).rows[0].uid,students[0].uid);});
test('duplicate names return every distinct student and exact count',async()=>{const result=await search('Aarav Sharma');assert.equal(result.count,3);assert.equal(new Set(result.rows.map(r=>r.uid)).size,3);});
test('section filter excludes the other duplicate names',async()=>{assert.equal((await search('Aarav',{section:' B '})).rows[0].section,'B');assert.equal((await search('Aarav',{section:'B'})).count,1);});
test('semester filter narrows matching names',async()=>{const result=await search('Aarav',{semester:'6'});assert.equal(result.count,1);assert.equal(result.rows[0].semester,6);});
test('department filter supports the existing ISE alias',async()=>{assert.equal((await search('Aarav',{department:'Information Science & Engineering'})).count,2);});
test('combined name, section, USN and email filters narrow safely',async()=>{assert.equal((await search('Aarav',{section:'B',usn:'102',email:'aarav1'})).count,1);});
test('unrelated students and zero matches are excluded',async()=>{assert.equal((await search('Ayesha')).count,1);assert.equal((await search('NobodyDoesExist')).count,0);});
test('latest authorized request shows current clearance and hall-ticket state',async()=>{assert.equal((await search('Ayesha')).rows[0].status.noDue,'Pending Accounts');const result=await search('Aarav');assert.equal(result.rows.find(r=>r.section==='B').status.hallTicket,'Issued');assert.equal(result.rows.find(r=>r.section==='A').status.noDue,'Pending Office · Cleared');assert.equal(result.rows.find(r=>r.section==='C').status.noDue,'No request');});
test('all workflow status labels remain display-only',()=>{for(const [status,label]of [['pending_mentor','Pending Mentor'],['pending_hod','Pending HOD'],['rejected','Rejected']])assert.equal(officeStatus({status}).noDue,label);});
test('office cannot edit profiles, marks, offerings or enrollments',async()=>{for(const collection of ['students','marks','offerings','enrollments','officeStudentSearch'])await assert.rejects(setDoc(doc(db,collection,students[0].uid),{name:'Forbidden change'}),e=>e.code==='permission-denied');});
test('search endpoint rejects anonymous and other roles and hides other offices requests',async()=>{await assert.rejects(searchOfficeStudents(server.db,null,{term:'Ayesha'}),e=>e.code==='unauthenticated');await assert.rejects(searchOfficeStudents(server.db,ids.mentor,{term:'Ayesha'}),e=>e.code==='permission-denied');await server.db.doc(`noDueRequests/${prefix}-foreign`).set({studentId:students[0].uid,officeId:'different-office',status:'issued',createdAt:new Date(Date.now()+60000)});assert.equal((await search('Ayesha')).rows[0].status.noDue,'Pending Accounts');});
test('index backfill is idempotent and does not alter student records',async()=>{const ref=server.db.doc(`students/${students[0].uid}`),before=(await ref.get()).data(),index=server.db.doc(`officeStudentSearch/${students[0].uid}`),time=(await index.get()).updateTime;await syncOfficeSearchIndex(server.db,students[0].uid);assert.deepEqual((await ref.get()).data(),before);assert.ok((await index.get()).updateTime.isEqual(time));});
test('controlled pagination returns all matches without duplicate students',async()=>{const batch=server.db.batch();for(let i=0;i<53;i++){const student={uid:prefix+'-page'+String(i).padStart(2,'0'),name:'PaginationNameOnly',usn:'PAGE'+i,email:'page'+i+'@demo.test',department:'ISE',semester:5,section:'A'};batch.set(server.db.doc(`students/${student.uid}`),student);}await batch.commit();for(let i=0;i<53;i++)await syncOfficeSearchIndex(server.db,prefix+'-page'+String(i).padStart(2,'0'));const first=await search('PaginationNameOnly'),second=await search('PaginationNameOnly',{},first.nextCursor);assert.equal(first.scanned,50);assert.equal(first.more,true);assert.equal(second.count,3);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.uid)).size,53);});
test('real Chrome search handles duplicate names, filters and mobile layout without issuing',async()=>{
  const require=createRequire(import.meta.url),{chromium}=require(process.env.DEMO_PLAYWRIGHT_MODULE||'C:/Users/Hp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  browser=await launchAuditBrowser(chromium,{headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(45000);
  await page.goto('http://127.0.0.1:5050/login.html');await page.locator('#email').fill(`${prefix}-office@demo.test`);await page.locator('#password').fill('DemoPassword123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(/office-dashboard/);await page.locator('#usnInput').fill('Aarav Sharma');await page.locator('#searchBtn').click();await page.getByText('3 students found with this name',{exact:true}).waitFor();assert.equal(await page.locator('.office-search-student').count(),3);assert.equal(await page.locator('#searchedStudentDetails').innerText(),'');
  await page.locator('#officeSection').fill('B');await page.locator('#searchBtn').click();await page.getByText('1 student found with this name',{exact:true}).waitFor();assert.match(await page.locator('#searchResult').innerText(),/Hall Ticket: Issued/);
  for(const width of [1366,768,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.locator('#officeSection').fill('');await page.locator('#usnInput').fill('NobodyDoesExist');await page.locator('#searchBtn').click();await page.getByText('0 students found with this name',{exact:true}).waitFor();assert.equal(await page.locator('.office-search-student').count(),0);
  await context.close();
});
