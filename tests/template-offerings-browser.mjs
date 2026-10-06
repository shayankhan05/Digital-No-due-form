// Real Chrome download/import verification against the current local demo.
// No resets, deletes, account replacements or direct academic data patches.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {localAdmin} from './bulk-fixture.mjs';
import {parseCSV} from '../js/csv.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.DEMO_PLAYWRIGHT_MODULE || 'playwright');
const server=localAdmin('demo-digital-no-due',8180,9199),base='http://127.0.0.1:5050',stamp=Date.now(),report={downloads:[],imports:[],teachers:[],students:[],errors:[]};let browser;
const csvPath=new URL('../templates/demo-teacher-offerings.csv',import.meta.url),rows=parseCSV(await readFile(csvPath,'utf8'),['department','scheme','semester','section','subjectCode','subjectName','teacherEmail','credits','components']);
async function login(email) {
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1366,height:900}}),page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(`${base}/login.html?emulator=1`);await page.locator('#email').fill(email);await page.locator('#password').fill('DemoPassword123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(/.*-dashboard\.html/);return {context,page};
}
async function preview(page,type,file) {
  await page.goto(`${base}/admin-dashboard.html`);await page.locator('#importType').selectOption(type);await page.locator('#importFile').setInputFiles(file);
  await page.locator('#previewBtn').click();await page.waitForFunction(()=>!document.getElementById('previewBtn').disabled&&document.getElementById('importProgress').textContent.startsWith('Preview ready'));assert.match(await page.locator('#importPreview').innerText(),/0 error rows/);
}
async function confirm(page) {
  await page.locator('#acceptWarnings').check();await page.locator('#importBtn').click();await page.waitForFunction(()=>document.getElementById('importProgress').textContent.includes('rows completed'));assert.match(await page.locator('#importProgress').innerText(),/0 failed or skipped/);report.imports.push(await page.locator('#importProgress').innerText());
}
async function originalMarks(){return new Map((await server.db.collection('marks').get()).docs.map(d=>[d.id,JSON.stringify(d.data())]));}
try {
  const marksBefore=await originalMarks();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const admin=await login('admin@demo.test');await admin.page.locator('#importType').waitFor();
  for(const [name,label] of [['student-import','Student template'],['teacher-import','Teacher template'],['offering-import','Offering template'],['ise-5c-2022-confirmed','Confirmed ISE 5C source']]) {
    const link=admin.page.getByRole('link',{name:label,exact:true});assert.equal(await link.getAttribute('href'),`templates/${name}.csv`);
    const downloaded=admin.page.waitForEvent('download');await link.click();const download=await downloaded;assert.equal(await download.failure(),null);assert.equal(download.suggestedFilename(),`${name}.csv`);
    const contents=[];for await(const chunk of await download.createReadStream())contents.push(chunk);assert.equal(Buffer.concat(contents).toString('utf8'),await readFile(new URL(`../templates/${name}.csv`,import.meta.url),'utf8'));report.downloads.push({file:`${name}.csv`,passed:true});
  }
  // Add clearly labelled test students through the normal UI. Existing profiles
  // and all marks remain untouched, including the CS-only legacy demo students.
  const headers=['name','usn','collegeEmail','phone','department','semester','section','scheme','mentorEmail'];
  const pupils=['A','B','C'].map(section=>({name:`Offering CSV Test ${section} ${stamp}`,usn:`CSV${stamp}${section}`,collegeEmail:`offering-csv-${stamp}-${section.toLowerCase()}@demo.test`,phone:'0000000000',department:'ISE',semester:5,section,scheme:'2022',mentorEmail:'mentor@demo.test'}));
  const pupilCSV=[headers.join(','),...pupils.map(p=>headers.map(h=>p[h]).join(','))].join('\r\n');
  await preview(admin.page,'students',{name:'offering-roster-test-students.csv',mimeType:'text/csv',buffer:Buffer.from(pupilCSV)});await confirm(admin.page);
  for(const p of pupils){const user=await server.auth.getUserByEmail(p.collegeEmail);report.students.push({...p,uid:user.uid});}
  for(let repeat=0;repeat<2;repeat++) {
    await preview(admin.page,'offerings',fileURLToPath(csvPath));assert.match(await admin.page.locator('#importPreview').innerText(),/5 rows uploaded · 5 valid/);await confirm(admin.page);
    const offers=await server.db.collection('offerings').where('department','==','ISE').where('scheme','==','2022').where('semester','==',5).get();
    assert.equal(offers.size,5);const ids=offers.docs.map(d=>d.id).sort();if(report.offeringIds)assert.deepEqual(ids,report.offeringIds);report.offeringIds=ids;
    for(const row of rows){const match=offers.docs.filter(d=>d.data().section===row.section&&d.data().subjectCode===row.subjectCode);assert.equal(match.length,1);assert.equal(match[0].data().teacherId,(await server.auth.getUserByEmail(row.teacherEmail)).uid);}
  }
  for(const row of rows) {
    const teacher=await login(row.teacherEmail);await teacher.page.goto(`${base}/academic.html?emulator=1`);await teacher.page.locator('.class-button').waitFor();assert.equal(await teacher.page.locator('.class-button').count(),1);
    assert.match(await teacher.page.locator('.class-button').innerText(),new RegExp(`${row.subjectCode} · Sem 5 / ${row.section}`));await teacher.page.locator('.class-button').click();await teacher.page.locator('.marks-form').waitFor();
    const uid=(await server.auth.getUserByEmail(row.teacherEmail)).uid,offeringId=await teacher.page.locator('.class-button').getAttribute('data-id');
    const roster=(await server.db.collection('enrollments').where('offeringId','==',offeringId).where('teacherId','==',uid).where('active','==',true).get()).docs;
    assert.equal(await teacher.page.locator('.marks-form').count(),roster.length);assert.ok(roster.length>0);const body=await teacher.page.locator('#classContent').innerText();
    for(const p of report.students)assert.equal(body.includes(p.name),p.section===row.section);
    for(const enrollment of roster){const p=(await server.db.doc(`students/${enrollment.data().studentId}`).get()).data();assert.equal(p.section,row.section);assert.equal(p.department,'ISE');assert.equal(p.scheme,'2022');assert.equal(p.semester,5);}
    report.teachers.push({email:row.teacherEmail,uid,offeringId,section:row.section,subjectCode:row.subjectCode,rosterSize:roster.length,browserLogin:true,noCrossSectionLeakage:true});await teacher.context.close();
  }
  for(const p of report.students) {const student=await login(p.collegeEmail);await student.page.locator('.subject-item').first().waitFor();assert.equal(await student.page.locator('.subject-item').count(),p.section==='A'?1:2);await student.context.close();}
  const marksAfter=await originalMarks();assert.equal(marksAfter.size,marksBefore.size);for(const [id,data] of marksBefore)assert.equal(marksAfter.get(id),data);report.existingMarksUnchanged=true;assert.deepEqual(report.errors,[]);report.passed=true;await admin.context.close();
}catch(error){report.passed=false;report.error=error.stack;throw error;}
finally {await writeFile(new URL('template-offerings-results.json',import.meta.url),JSON.stringify(report,null,2));if(browser)await browser.close();await server.app.delete();console.log(JSON.stringify({passed:report.passed,downloads:report.downloads.length,teachers:report.teachers.length,error:report.error},null,2));}
