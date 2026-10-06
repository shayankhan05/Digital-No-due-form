// End-to-end regression against the user's running LOCAL demo, through real pages.
// Does not seed/reset data. Reimports existing rows and adds one synthetic C student.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {localAdmin} from './bulk-fixture.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.DEMO_PLAYWRIGHT_MODULE || 'playwright');
const server=localAdmin('demo-digital-no-due',8180,9199);
const base='http://127.0.0.1:5050';
const report={project:'demo-digital-no-due',calls:[],imports:[],browserChecks:[]};
let browser;
const rows=[],uids=new Map();
const offerings=['demo-dbms-5-C','demo-java-5-C','demo-os-5-C'];
const targetEmail='ise-demo-1ay24is158@demo.test';
const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const headers=['name','usn','collegeEmail','phone','department','semester','section','scheme','mentorEmail'];
async function login(email) {
  const context=await browser.newContext();const page=await context.newPage();
  page.setDefaultTimeout(45000);page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(`${base}/login.html?emulator=1`,{waitUntil:'load'});
  await page.locator('#email').fill(email);await page.locator('#password').fill('DemoPassword123!');
  await page.getByRole('button',{name:'Log in',exact:true}).click();
  await page.waitForURL(/.*-dashboard\.html/);
  return {context,page};
}
async function records(uid) {
  const [student,enrollments,plan]=await Promise.all([server.db.doc(`students/${uid}`).get(),server.db.collection('enrollments').where('studentId','==',uid).get(),server.db.doc(`students/${uid}/clearance/plan`).get()]);
  return {uid,student:student.data(),enrollments:enrollments.docs.map(d=>({id:d.id,...d.data()})),plan:plan.data()};
}
try {
  const initial=(await server.db.collection('students').get()).docs;
  for(const d of initial.filter(d=>/^ise-demo-1ay24is15[5-9]@demo\.test$/.test(d.data().email))) {
    const s=d.data(),mentor=(await server.db.doc(`users/${s.mentorId}`).get()).data();
    rows.push({name:s.name,usn:s.usn,collegeEmail:s.email,phone:s.phone,department:s.department,semester:s.semester,section:s.section,scheme:s.scheme,mentorEmail:mentor.email});uids.set(s.email,d.id);
  }
  assert.equal(rows.length,5,'Expected the five existing runtime CSV students.');
  report.before=await records(uids.get(targetEmail));
  const baselineMarks=(await server.db.collection('marks').get()).docs.map(d=>({id:d.id,...d.data()}));
  const fixtureOffers=(await server.db.collection('offerings').get()).docs;
  assert.deepEqual(fixtureOffers.map(d=>d.id).sort(),offerings.toSorted(),'This runtime reproduction expects the clean npm run seed offering set.');
  report.offeringShape=fixtureOffers.map(d=>({id:d.id,active:d.data().active ?? '(omitted)',semester:d.data().semester,section:d.data().section,department:d.data().department ?? '(omitted)',scheme:d.data().scheme ?? '(omitted)'}));
  const suffix=Date.now().toString();
  const fresh={...rows.find(r=>r.section==='C'),name:'Synthetic browser import student',usn:`RUNTIME${suffix}`,collegeEmail:`runtime-import-${suffix}@demo.test`};
  rows.push(fresh);
  const csv=[headers.join(','),...rows.map(r=>headers.map(k=>quote(r[k])).join(','))].join('\r\n');
  browser=await chromium.launch({headless:true,executablePath:process.env.DEMO_BROWSER_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const {context:adminContext,page:adminPage}=await login('admin@demo.test');
  adminPage.on('response',async response=>{
    if(response.url()==='http://127.0.0.1:5001/demo-digital-no-due/us-central1/institutionalAdmin') {
      const data=response.request().postDataJSON()?.data,result=(await response.json()).result;
      report.calls.push({action:data?.action,status:response.status(),uid:result?.uid,subjectsMapped:result?.subjectsMapped});
    }
  });
  await adminPage.waitForSelector('#importFile');
  for(let pass=0;pass<2;pass++) {
    await adminPage.locator('#importType').selectOption('students');
    await adminPage.locator('#importFile').setInputFiles({name:'runtime-five-students-plus-new.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await adminPage.locator('#previewBtn').click();
    await adminPage.locator('#importProgress').filter({hasText:'Preview ready.'}).waitFor();
    assert.match(await adminPage.locator('#importPreview').innerText(),/0 error rows/);
    await adminPage.locator('#acceptWarnings').check();await adminPage.locator('#importBtn').click();
    await adminPage.locator('#downloadReport').waitFor({state:'visible'});
    await adminPage.waitForFunction(()=>!document.getElementById('downloadReport').disabled);
    report.imports.push(await adminPage.locator('#importResults').innerText());
    await adminPage.screenshot({path:fileURLToPath(new URL(`runtime-import-pass-${pass+1}.png`,import.meta.url)),fullPage:true});
  }
  await adminContext.close();
  for(const row of rows) {
    const authUser=await server.auth.getUserByEmail(row.collegeEmail);
    if(uids.has(row.collegeEmail))assert.equal(authUser.uid,uids.get(row.collegeEmail));
    const current=await records(authUser.uid),expected=row.section==='C'?3:0;
    assert.equal(current.enrollments.length,expected);
    if(expected) {
      assert.deepEqual(current.enrollments.map(e=>e.id).sort(),offerings.map(o=>`${authUser.uid}__${o}`).sort());
      assert.ok(current.enrollments.every(e=>e.studentId===authUser.uid && e.active===true && e.section===row.section));
      assert.equal(current.plan.valid,true);assert.equal(current.student.offeringIds.length,3);
    }
  }
  report.after=await records(uids.get(targetEmail));
  const student=await login(targetEmail);
  await student.page.getByRole('heading',{name:'Your Subjects',exact:true}).waitFor();
  await student.page.getByText('Database Management Systems',{exact:true}).waitFor();
  assert.equal(await student.page.locator('.subject-item').count(),3);
  await student.page.getByRole('button',{name:'Refresh status & notifications',exact:true}).click();
  await student.page.getByText('Database Management Systems',{exact:true}).waitFor();assert.equal(await student.page.locator('.subject-item').count(),3);
  await student.page.screenshot({path:fileURLToPath(new URL('runtime-ayesha-dashboard.png',import.meta.url)),fullPage:true});
  await student.page.goto(`${base}/academic.html?emulator=1`,{waitUntil:'load'});
  await student.page.locator('.academic-subject').first().waitFor();assert.equal(await student.page.locator('.academic-subject').count(),3);
  report.browserChecks.push('Ayesha login, dashboard 3 subjects, refresh, academic page 3 subjects');await student.context.close();
  const freshLogin=await login(fresh.collegeEmail);await freshLogin.page.locator('.subject-item').first().waitFor();assert.equal(await freshLogin.page.locator('.subject-item').count(),3);await freshLogin.context.close();
  report.browserChecks.push('New CSV-provisioned student: first login immediately shows 3 subjects');
  for(const [email,offeringId] of [['subject_faculty@demo.test',offerings[0]],['java_faculty@demo.test',offerings[1]],['os_faculty@demo.test',offerings[2]]]) {
    const teacher=await login(email);await teacher.page.goto(`${base}/academic.html?emulator=1`,{waitUntil:'load'});
    await teacher.page.locator(`.class-button[data-id="${offeringId}"]`).click();
    await teacher.page.locator('.marks-form').filter({hasText:'Ayesha Siddiqui'}).waitFor();
    assert.equal(await teacher.page.locator('.marks-form').filter({hasText:'1AY24IS158'}).count(),1);
    assert.equal(await teacher.page.locator('.marks-form').filter({hasText:'1AY24IS156'}).count(),0);
    assert.equal(await teacher.page.locator('.marks-form').filter({hasText:'1AY24IS157'}).count(),0);
    report.browserChecks.push(`${email}: Ayesha present once in ${offeringId}; Section A/B absent`);await teacher.context.close();
  }
  assert.deepEqual((await server.db.collection('marks').get()).docs.map(d=>({id:d.id,...d.data()})),baselineMarks);
  const asha=await server.auth.getUserByEmail('student@demo.test');assert.equal((await records(asha.uid)).enrollments.length,3);
  report.browserChecks.push('Existing marks unchanged; Asha retains 3 enrollments');
  report.passed=true;
} catch(error) {report.passed=false;report.error=error.stack;throw error;}
finally {
  await writeFile(new URL('runtime-import-browser-results.json',import.meta.url),JSON.stringify(report,null,2));
  if(browser)await browser.close();await server.app.delete();
  console.log(JSON.stringify({passed:report.passed,checks:report.browserChecks,ayeshaUid:report.after?.uid,enrollmentIds:report.after?.enrollments.map(e=>e.id),error:report.error},null,2));
}
