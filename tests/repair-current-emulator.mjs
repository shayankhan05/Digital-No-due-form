// Restore the existing 50-row demo CSV through Chrome's normal admin flow.
// Loopback demo only. Never seed/reset/delete or replace an existing identity.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {localAdmin} from './bulk-fixture.mjs';
import {parseCSV} from '../js/csv.js';
import {reconcileDemoProfiles,auditProfiles} from './institutional-profile-tools.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.DEMO_PLAYWRIGHT_MODULE || 'playwright');
const server=localAdmin('demo-digital-no-due',8180,9199),base='http://127.0.0.1:5050';
const targets=[['BCS511','A','aarav.mehta@demo.test'],['BCS512','B','nida.farooq@demo.test'],['BCS513','C','rohit.kulkarni@demo.test'],['BCS514','B','sana.mir@demo.test'],['BCS515','C','vivek.reddy@demo.test']];
const report={imports:[],classes:[],newMarks:[],browserErrors:[]};let browser;
const txt=v=>String(v??'').trim(),dept=v=>['ise','information science & engineering','information science and engineering'].includes(txt(v).toLowerCase())?'ISE':txt(v);
const sourceURL=new URL('../templates/demo-students-50.csv',import.meta.url),csv=await readFile(sourceURL,'utf8'),csvRows=parseCSV(csv,['name','usn','collegeEmail','department','semester','section','scheme','mentorEmail']);
async function snapshot() {
  const result={};async function visit(collection){for(const d of (await collection.get()).docs){result[d.ref.path]=d.data();for(const child of await d.ref.listCollections())await visit(child);}}
  for(const collection of await server.db.listCollections())await visit(collection);return result;
}
async function authState() {
  const users={};let token;do{const batch=await server.auth.listUsers(1000,token);for(const u of batch.users)users[u.uid]=createHash('sha256').update(JSON.stringify({email:u.email,displayName:u.displayName,passwordHash:u.passwordHash,passwordSalt:u.passwordSalt,disabled:u.disabled,emailVerified:u.emailVerified,customClaims:u.customClaims,providerData:u.providerData})).digest('hex');token=batch.pageToken;}while(token);return users;
}
async function classState() {
  const students=(await server.db.collection('students').get()).docs.map(d=>({uid:d.id,...d.data()}));const classes=[];
  for(const [code,section,email] of targets){const offers=await server.db.collection('offerings').where('subjectCode','==',code).get(),matching=offers.docs.filter(d=>dept(d.data().department)==='ISE'&&txt(d.data().scheme)==='2022'&&Number(d.data().semester)===5&&txt(d.data().section).toUpperCase()===section);assert.equal(matching.length,1);const offer=matching[0];assert.equal(offer.data().teacherId,(await server.auth.getUserByEmail(email)).uid);assert.equal(offer.data().active,true);const pupils=students.filter(s=>dept(s.department)==='ISE'&&txt(s.scheme)==='2022'&&Number(s.semester)===5&&txt(s.section).toUpperCase()===section);const enrolled=await server.db.collection('enrollments').where('offeringId','==',offer.id).where('active','==',true).get();classes.push({code,section,email,id:offer.id,offering:offer.data(),students:pupils,enrollments:enrolled.docs.map(d=>({id:d.id,...d.data()})),missingStudentIds:pupils.filter(s=>!enrolled.docs.some(d=>d.data().studentId===s.uid)).map(s=>s.uid)});}
  return classes;
}
async function login(email){const context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>report.browserErrors.push(e.message));page.on('dialog',d=>d.dismiss());await page.goto(`${base}/login.html?emulator=1`);await page.locator('#email').fill(email);await page.locator('#password').fill('DemoPassword123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(/.*-dashboard\.html/);return {context,page};}
async function importCSV(page,type,file) {
  await page.goto(`${base}/admin-dashboard.html`);await page.locator('#importType').selectOption(type);await page.locator('#importFile').setInputFiles(file);await page.locator('#previewBtn').click();await page.waitForFunction(()=>!document.getElementById('previewBtn').disabled&&document.getElementById('importProgress').textContent.startsWith('Preview ready'));assert.match(await page.locator('#importPreview').innerText(),/0 error rows/);await page.locator('#acceptWarnings').check();await page.locator('#importBtn').click();await page.waitForFunction(()=>document.getElementById('importProgress').textContent.includes('rows completed'));const status=await page.locator('#importProgress').innerText();assert.match(status,/0 failed or skipped/);report.imports.push({type,status});console.log(status);
}
try {
  const before=await snapshot(),beforeAuth=await authState();report.before=(await classState()).map(c=>({code:c.code,section:c.section,students:c.students.length,missingEnrollments:c.missingStudentIds.length}));
  await writeFile(new URL('current-emulator-repair-before-results.json',import.meta.url),JSON.stringify({firestore:before,authFingerprints:beforeAuth,classes:report.before},null,2));
  assert.equal(csvRows.length,50);assert.ok(csvRows.every(r=>dept(r.department)==='ISE'&&r.semester==='5'&&r.scheme==='2022'&&['A','B','C'].includes(r.section)));
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const admin=await login('admin@demo.test');
  const api=(action,data={})=>admin.page.evaluate(async payload=>{const {functions}=await import('/js/firebase-config.js'),{httpsCallable}=await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js');return (await httpsCallable(functions,'institutionalAdmin')(payload)).data;},{action,...data});
  const recovery=await reconcileDemoProfiles(server,api);report.orphanAudit={found:recovery.before.demoIssues.length,repaired:recovery.results.length};
  assert.deepEqual(recovery.unresolved,[],'A known Auth identity is missing a verified source; refusing to finish a partial repair.');
  assert.deepEqual(recovery.after.demoIssues,[]);
  await importCSV(admin.page,'students',fileURLToPath(sourceURL));
  const firstStudentSnapshot=await server.db.collection('students').get(),firstEnrollmentSnapshot=await server.db.collection('enrollments').get(),firstAuth=await authState();
  console.log('Demo students restored; verifying repeat import and backfill.');
  await importCSV(admin.page,'students',fileURLToPath(sourceURL));
  // Backfill existing cohorts through the same offering import used by admins.
  const classes=await classState(),offeringRows=classes.map(c=>({department:c.offering.department,scheme:c.offering.scheme,semester:c.offering.semester,section:c.offering.section,subjectCode:c.code,subjectName:c.offering.subjectName,teacherEmail:c.email,credits:c.offering.credits,components:JSON.stringify(c.offering.components)}));
  const headers=Object.keys(offeringRows[0]),quote=v=>'"'+String(v??'').replaceAll('"','""')+'"',offeringCSV=[headers.join(','),...offeringRows.map(r=>headers.map(k=>quote(r[k])).join(','))].join('\r\n'),file={name:'current-demo-backfill.csv',mimeType:'text/csv',buffer:Buffer.from(offeringCSV)};
  await importCSV(admin.page,'offerings',file);await importCSV(admin.page,'offerings',file);
  assert.equal((await server.db.collection('students').get()).size,firstStudentSnapshot.size);assert.equal((await server.db.collection('enrollments').get()).size,firstEnrollmentSnapshot.size);assert.deepEqual(await authState(),firstAuth);report.repeatImportsIdempotent=true;
  const repaired=await classState();
  for(const c of repaired) {
    assert.deepEqual(c.missingStudentIds,[]);assert.deepEqual(c.enrollments.map(e=>e.studentId).sort(),c.students.map(s=>s.uid).sort());
    const teacher=await login(c.email);await teacher.page.goto(`${base}/academic.html?emulator=1`);await teacher.page.locator(`.class-button[data-id="${c.id}"]`).click();await teacher.page.waitForFunction(()=>document.querySelector('#classContent')?.textContent.includes('No-Due:'));
    const visible=await teacher.page.locator('#classContent .marks-form').evaluateAll(forms=>forms.map(f=>f.dataset.id));assert.deepEqual(visible.sort(),c.enrollments.map(e=>e.id).sort());
    // All restored demo pupils carry the same institutional class tuple; check
    // the actual form IDs, not names/counts alone, to rule out cross-section access.
    report.classes.push({code:c.code,section:c.section,teacher:c.email,offeringId:c.id,students:c.students.length,demoStudents:c.students.filter(s=>csvRows.some(r=>r.collegeEmail===s.email)).length,missingEnrollments:0,browserRosterVerified:true,studentSamples:c.students.filter(s=>csvRows.some(r=>r.collegeEmail===s.email)).slice(0,4).map(s=>({name:s.name,usn:s.usn}))});
    if(c.code==='BCS514') {
      const selected=csvRows.filter(r=>r.section==='B').slice(0,2),component=c.offering.components[0];
      for(let i=0;i<selected.length;i++) {
        const pupil=c.students.find(s=>s.email===selected[i].collegeEmail),enrollment=c.enrollments.find(e=>e.studentId===pupil.uid),existingMark=await server.db.doc(`marks/${enrollment.id}`).get();
        if(existingMark.exists){const score=existingMark.data().scores[component.id];if(score!==undefined)report.newMarks.push({studentEmail:pupil.email,studentId:pupil.uid,enrollmentId:enrollment.id,component:component.id,score,preservedExisting:true});continue;}
        const form=teacher.page.locator(`.marks-form[data-id="${enrollment.id}"]`),score=Math.min(component.max,i?24:18);await form.locator(`[name="${component.id}"]`).fill(String(score));await form.getByRole('button',{name:'Save marks'}).click();await teacher.page.waitForFunction(()=>![...document.querySelectorAll('.marks-form button')].some(b=>b.disabled));assert.equal((await server.db.doc(`marks/${enrollment.id}`).get()).data().scores[component.id],score);report.newMarks.push({studentEmail:pupil.email,studentId:pupil.uid,enrollmentId:enrollment.id,component:component.id,score});
      }
    }
    await teacher.context.close();
  }
  // Every restored student can log in, and sees exactly their active enrollment
  // count. Also verify the two independently saved demo marks in student views.
  for(const row of csvRows) {
    const pupil=await server.auth.getUserByEmail(row.collegeEmail),enrolled=await server.db.collection('enrollments').where('studentId','==',pupil.uid).where('active','==',true).get();assert.ok(enrolled.size>0);const student=await login(row.collegeEmail);await student.page.locator('.subject-item').first().waitFor();assert.equal(await student.page.locator('.subject-item').count(),enrolled.size);
    const mark=report.newMarks.find(m=>m.studentId===pupil.uid);if(mark){await student.page.goto(`${base}/academic.html?emulator=1`);await student.page.waitForFunction(()=>document.getElementById('content')?.textContent.includes('Subjects & Marks'));const section=student.page.locator('.academic-subject').filter({has:student.page.locator('h3',{hasText:'BCS514'})});assert.ok((await section.innerText()).includes(String(mark.score)));assert.equal((await server.db.doc(`marks/${mark.enrollmentId}`).get()).data().scores[mark.component],mark.score);}
    await student.context.close();
  }
  report.studentBrowserLoginsVerified=50;
  const final=await snapshot(),finalAuth=await authState();
  for(const [uid,fingerprint] of Object.entries(beforeAuth))assert.equal(finalAuth[uid],fingerprint,`Existing Auth identity/password changed: ${uid}`);
  for(const [path,data] of Object.entries(before)) {
    assert.ok(final[path],`Existing document deleted: ${path}`);
    if(/^students\/[^/]+\/clearance\/plan$/.test(path))continue; // Derived mappings are intentionally refreshed.
    if(/^students\/[^/]+$/.test(path)) {const strip=value=>Object.fromEntries(Object.entries(value).filter(([k])=>!['offeringIds','teacherIds'].includes(k)));assert.deepEqual(strip(final[path]),strip(data),`Existing profile changed: ${path}`);}
    else assert.deepEqual(final[path],data,`Existing data overwritten: ${path}`);
  }
  assert.deepEqual((await auditProfiles(server)).demoIssues,[]);
  report.preserved={existingAuthAndPasswords:true,existingMarks:true,existingEnrollments:true,existingOfferings:true,noDueRequestsAndNotifications:true,allExistingDocumentsRetained:true};report.passed=true;assert.deepEqual(report.browserErrors,[]);await admin.context.close();
}catch(error){report.passed=false;report.error=error.stack;throw error;}
finally {await writeFile(new URL('current-emulator-repair-results.json',import.meta.url),JSON.stringify(report,null,2));if(browser)await browser.close();await server.app.delete();console.log(JSON.stringify({passed:report.passed,classes:report.classes.map(c=>({code:c.code,section:c.section,students:c.students,demoStudents:c.demoStudents})),error:report.error},null,2));}
