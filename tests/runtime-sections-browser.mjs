// Real Chrome regression: provisioning -> 9-offering CSV -> repeated student CSV.
// Demo emulator only; preserves marks and retains superseded legacy enrollments.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseCSV} from '../js/csv.js';
import {localAdmin} from './bulk-fixture.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.DEMO_PLAYWRIGHT_MODULE || 'playwright');
const server=localAdmin('demo-digital-no-due',8180,9199);
const base='http://127.0.0.1:5050',report={project:'demo-digital-no-due',checks:[],calls:[]};
const headers=['name','usn','collegeEmail','phone','department','semester','section','scheme','mentorEmail'];
const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
let browser;
async function login(email) {
  const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(45000);page.on('dialog',d=>d.dismiss());
  await page.goto(`${base}/login.html?emulator=1`,{waitUntil:'load'});
  await page.locator('#email').fill(email);await page.locator('#password').fill('DemoPassword123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(/.*-dashboard\.html/);return {context,page};
}
async function snapshot(uid) {
  const [s,e,p]=await Promise.all([server.db.doc(`students/${uid}`).get(),server.db.collection('enrollments').where('studentId','==',uid).get(),server.db.doc(`students/${uid}/clearance/plan`).get()]);
  return {uid,student:s.data(),enrollments:e.docs.map(d=>({id:d.id,...d.data()})),plan:p.data()};
}
async function preview(page,type,file) {
  await page.locator('#importType').selectOption(type);await page.locator('#importFile').setInputFiles(file);await page.locator('#previewBtn').click();
  await page.waitForFunction(()=>!document.getElementById('previewBtn').disabled && document.getElementById('importPreview').textContent.includes('rows uploaded'));
}
async function confirm(page) {
  await page.locator('#acceptWarnings').check();await page.locator('#importBtn').click();await page.waitForFunction(()=>!document.getElementById('downloadReport').disabled);
  assert.match(await page.locator('#importProgress').innerText(),/0 failed or skipped/);
}
try {
  const students=(await server.db.collection('students').get()).docs.filter(d=>/^ise-demo-1ay24is15[5-9]@demo\.test$/.test(d.data().email));assert.equal(students.length,5);
  report.before=await Promise.all(students.map(d=>snapshot(d.id)));
  const marks=(await server.db.collection('marks').get()).docs.map(d=>({id:d.id,...d.data()}));
  const offerPath=fileURLToPath(new URL('../templates/local-test-offerings.csv',import.meta.url));
  const offerRows=parseCSV(await readFile(offerPath,'utf8'),['department','scheme','semester','section','subjectCode','subjectName','teacherEmail','components']);assert.equal(offerRows.length,9);
  browser=await chromium.launch({headless:true,executablePath:process.env.DEMO_BROWSER_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const admin=await login('admin@demo.test');await admin.page.locator('#importFile').waitFor();
  admin.page.on('response',async response=>{if(response.url()==='http://127.0.0.1:5001/demo-digital-no-due/us-central1/institutionalAdmin') {const data=response.request().postDataJSON()?.data,result=(await response.json()).result;report.calls.push({action:data?.action,status:response.status(),uid:result?.uid,subjectsMapped:result?.subjectsMapped});}});
  await preview(admin.page,'offerings',offerPath);
  report.initialOfferingPreview=await admin.page.locator('#importPreview').innerText();
  if(report.initialOfferingPreview.includes('6 error rows')) {
    await admin.page.locator('#acceptWarnings').check();assert.equal(await admin.page.locator('#importBtn').isDisabled(),true);
    report.checks.push('Missing A/B faculty: six invalid rows clearly reported; partial offering import blocked');
    const form=admin.page.locator('#accountForm');
    await form.locator('[name="role"]').selectOption('subject_faculty');
    for(const [name,value] of Object.entries({name:'Demo A/B Faculty',collegeEmail:'ise-ab-faculty@demo.test',department:'ISE',facultyId:'ISE-DEMO-AB'}))await form.locator(`[name="${name}"]`).fill(value);
    await admin.page.locator('#validateAccountBtn').click();await admin.page.waitForFunction(()=>!document.getElementById('provisionBtn').disabled);await admin.page.locator('#provisionBtn').click();await admin.page.locator('#accountStatus').filter({hasText:'Created ise-ab-faculty@demo.test'}).waitFor();
    report.checks.push('Required demo A/B teacher provisioned through the actual admin form');
    await preview(admin.page,'offerings',offerPath);
  }
  assert.match(await admin.page.locator('#importPreview').innerText(),/9 valid/);assert.match(await admin.page.locator('#importPreview').innerText(),/0 error rows/);
  await confirm(admin.page);report.checks.push('All nine offerings imported successfully through Chrome');
  const rows=[];for(const d of students) {const s=d.data(),m=(await server.db.doc(`users/${s.mentorId}`).get()).data();rows.push({name:s.name,usn:s.usn,collegeEmail:s.email,phone:s.phone,department:s.department,semester:s.semester,section:s.section,scheme:s.scheme,mentorEmail:m.email});}
  const csv=[headers.join(','),...rows.map(r=>headers.map(k=>quote(r[k])).join(','))].join('\r\n');
  for(let pass=0;pass<2;pass++) {
    await preview(admin.page,'students',{name:'runtime-five-students.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});assert.match(await admin.page.locator('#importPreview').innerText(),/0 error rows/);await confirm(admin.page);
  }
  await admin.context.close();report.checks.push('Five-student CSV imported twice using the real callable function');
  report.offerings=(await server.db.collection('offerings').get()).docs.filter(d=>d.data().department==='ISE' && d.data().scheme==='2022').map(d=>({id:d.id,...d.data()}));assert.equal(report.offerings.length,9);
  report.after=await Promise.all(students.map(d=>snapshot(d.id)));
  for(const s of report.after) {
    const active=s.enrollments.filter(e=>e.active===true),expected=report.offerings.filter(o=>o.section===s.student.section);
    assert.equal(active.length,3);assert.equal(new Set(active.map(e=>e.offeringId)).size,3);assert.equal(s.plan.valid,true);assert.equal(Object.values(s.plan.items).filter(i=>i.approverType==='subject_faculty').length,3);
    assert.deepEqual(active.map(e=>e.id).sort(),expected.map(o=>`${s.uid}__${o.id}`).sort());assert.ok(active.every(e=>e.studentId===s.uid && e.section===s.student.section));
    const client=await login(s.student.email);await client.page.locator('.subject-item').first().waitFor();assert.equal(await client.page.locator('.subject-item').count(),3);
    await client.page.getByRole('button',{name:'Refresh status & notifications',exact:true}).click();await client.page.getByText('Software Engineering & Project Management',{exact:true}).waitFor();assert.equal(await client.page.locator('.subject-item').count(),3);
    await client.page.screenshot({path:fileURLToPath(new URL(`runtime-section-${s.student.section}-${s.student.usn}.png`,import.meta.url)),fullPage:true});
    await client.page.goto(`${base}/academic.html?emulator=1`,{waitUntil:'load'});await client.page.locator('.academic-subject').first().waitFor();assert.equal(await client.page.locator('.academic-subject').count(),3);await client.context.close();
    report.checks.push(`${s.student.name}: Section ${s.student.section}, dashboard and academic page each show 3 BCS subjects`);
  }
  for(const email of new Set(offerRows.map(r=>r.teacherEmail))) {
    const teacher=await server.auth.getUserByEmail(email),client=await login(email);await client.page.goto(`${base}/academic.html?emulator=1`,{waitUntil:'load'});
    for(const offering of report.offerings.filter(o=>o.teacherId===teacher.uid)) {
      await client.page.locator(`.class-button[data-id="${offering.id}"]`).click();await client.page.locator('#classContent .marks-form').first().waitFor();
      const rosterText=await client.page.locator('#classContent').innerText();
      for(const s of report.after) {const found=rosterText.includes(s.student.usn);assert.equal(found,s.student.section===offering.section);}
      report.checks.push(`${email}: ${offering.subjectCode} ${offering.section} roster correct, no cross-section students`);
    }
    for(const other of report.offerings.filter(o=>o.teacherId!==teacher.uid))assert.equal(await client.page.locator(`.class-button[data-id="${other.id}"]`).count(),0);
    await client.context.close();
  }
  assert.deepEqual((await server.db.collection('marks').get()).docs.map(d=>({id:d.id,...d.data()})),marks);
  for(const old of report.before)for(const enrollment of old.enrollments)assert.ok((await server.db.doc(`enrollments/${enrollment.id}`).get()).exists,'Existing enrollment record was deleted');
  report.checks.push('All pre-existing marks unchanged; all pre-existing enrollment documents retained');report.passed=true;
} catch(error) {report.passed=false;report.error=error.stack;throw error;}
finally {
  await writeFile(new URL('runtime-sections-browser-results.json',import.meta.url),JSON.stringify(report,null,2));
  if(browser)await browser.close();await server.app.delete();console.log(JSON.stringify({passed:report.passed,checks:report.checks,error:report.error},null,2));
}
