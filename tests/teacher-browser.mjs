// Actual Chrome -> admin upload/preview/confirm -> local callable Functions.
// Add uniquely named synthetic fixtures only to the isolated audit emulators.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {auditAdmin,launchAuditBrowser} from './audit-browser-runtime.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.DEMO_PLAYWRIGHT_MODULE || 'playwright');
const previewOnly=process.argv.includes('--preview-only');
const previous=previewOnly?JSON.parse(await readFile(new URL('teacher-browser-results.json',import.meta.url),'utf8')):null;
const server=auditAdmin(),base='http://127.0.0.1:5050',prefix=previous?.prefix || `teacher-browser-${Date.now()}`,scheme=prefix;
const report={prefix,teachers:[],students:[],offerings:[],layouts:[],errors:[]};let browser;
async function snapshot() {
  const records=new Map();
  async function visit(collection) {for(const doc of (await collection.get()).docs){records.set(doc.ref.path,JSON.stringify(doc.data()));for(const child of await doc.ref.listCollections())await visit(child);}}
  for(const collection of await server.db.listCollections())await visit(collection);return records;
}
const csv=rows=>{const headers=Object.keys(rows[0]),quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';return [headers.join(','),...rows.map(row=>headers.map(k=>quote(row[k])).join(','))].join('\r\n');};
async function login(email) {
  const context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage();page.setDefaultTimeout(45000);
  page.on('pageerror',error=>report.errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(`${base}/login.html?emulator=1`);await page.locator('#email').fill(email);await page.locator('#password').fill('DemoPassword123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(/.*-dashboard\.html/);return {context,page};
}
async function upload(page,type,rows,confirm=true,expectedErrors=0) {
  await page.goto(`${base}/admin-dashboard.html?emulator=1`);await page.locator('#importType').selectOption(type);
  await page.locator('#importFile').setInputFiles({name:`${prefix}-${type}.csv`,mimeType:'text/csv',buffer:Buffer.from(csv(rows))});
  await page.locator('#previewBtn').click();await page.waitForFunction(()=>!document.getElementById('previewBtn').disabled&&document.getElementById('importProgress').textContent.startsWith('Preview ready'));
  assert.match(await page.locator('#importPreview').innerText(),new RegExp(`${expectedErrors} error rows`));
  if(confirm) {await page.locator('#acceptWarnings').check();await page.locator('#importBtn').click();await page.waitForFunction(()=>document.getElementById('importProgress').textContent.includes('rows completed'));assert.match(await page.locator('#importProgress').innerText(),/0 failed or skipped/);}
}
async function layout(page,width) {
  await page.setViewportSize({width,height:900});
  const metrics=await page.evaluate(()=>{const shell=document.querySelector('.app-shell').getBoundingClientRect(),table=document.querySelector('#importPreview .table-scroll'),buttons=[...document.querySelectorAll('.provision-actions button')].map(b=>b.getBoundingClientRect());return {width:innerWidth,shell:shell.width,left:shell.left,overflow:document.documentElement.scrollWidth>innerWidth+1,tableScroll:table&&getComputedStyle(table).overflowX==='auto',overlap:Math.min(buttons[0].right,buttons[1].right)>Math.max(buttons[0].left,buttons[1].left)+1&&Math.min(buttons[0].bottom,buttons[1].bottom)>Math.max(buttons[0].top,buttons[1].top)+1};});
  assert.equal(metrics.shell,Math.min(width,1040));assert.equal(metrics.left,(width-metrics.shell)/2);assert.equal(metrics.overflow,false);assert.equal(metrics.overlap,false);assert.equal(metrics.tableScroll,true);report.layouts.push(metrics);
}
try {
  const before=await snapshot();browser=await launchAuditBrowser(chromium,{headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const admin=await login('admin@demo.test');
  if(previewOnly) {
    const teachers=await Promise.all(previous.teachers.map(async teacher=>{const p=(await server.db.doc(`users/${teacher.uid}`).get()).data();return {name:p.name,collegeEmail:p.email,phone:p.phone,department:p.department,employeeId:p.facultyId,role:p.role};}));
    const many=[teachers[0],...Array.from({length:99},(_,i)=>({...teachers[0],collegeEmail:`${prefix}-preview${i}@demo.test`,employeeId:`${prefix}-PREVIEW${i}`})),teachers[0]];
    await upload(admin.page,'teachers',many,false,2);assert.match(await admin.page.locator('#importPreview').innerText(),/2 duplicate rows/);
    assert.equal(await admin.page.locator('#importBtn').isDisabled(),true);
    await upload(admin.page,'teachers',[{...teachers[0],role:'admin'}],false,1);await admin.page.locator('#acceptWarnings').check();assert.equal(await admin.page.locator('#importBtn').isDisabled(),true);
    await upload(admin.page,'teachers',teachers,false);
    for(const width of [1920,1366,768,390]){await layout(admin.page,width);await admin.page.locator('#importPreview').scrollIntoViewIfNeeded();await admin.page.screenshot({path:fileURLToPath(new URL(`teacher-preview-${width}.png`,import.meta.url)),fullPage:true});}
    const after=await snapshot();assert.equal(after.size,before.size);for(const [path,data] of before)assert.equal(after.get(path),data,`Read-only preview changed ${path}`);
    report.passed=true;report.crossChunkDuplicateCheck=true;report.invalidRoleCheck=true;report.existingDemoDataUnchanged=true;await admin.context.close();
  } else {
  const teachers=Array.from({length:6},(_,i)=>({name:`Temporary Teacher ${i+1}`,collegeEmail:`${prefix}-faculty${i+1}@demo.test`,phone:'0000000000',department:'ISE',employeeId:`${prefix}-FAC${i+1}`,role:'subject_faculty'}));
  await upload(admin.page,'teachers',teachers);
  for(const row of teachers){const account=await server.auth.getUserByEmail(row.collegeEmail),profile=(await server.db.doc(`users/${account.uid}`).get()).data();assert.equal(profile.facultyId,row.employeeId);assert.equal(profile.role,'subject_faculty');report.teachers.push({email:row.collegeEmail,uid:account.uid,employeeId:row.employeeId});}
  const sections=['A','A','B','B','C','C'],codes=['BCS501','BCS502','BCS501','BCS503','BCS502','BCS503'];
  const names={BCS501:'Software Engineering & Project Management',BCS502:'Computer Networks',BCS503:'Theory of Computation'};
  const offerings=teachers.map((row,i)=>({department:'ISE',scheme,semester:10,section:sections[i],subjectCode:codes[i],subjectName:names[codes[i]],teacherEmail:row.collegeEmail,credits:'',components:JSON.stringify([{id:'ia1',label:'Internal',max:30},{id:'assignment',label:'Assignment',max:10}]),active:true}));
  await upload(admin.page,'offerings',offerings);
  report.offerings=(await server.db.collection('offerings').where('scheme','==',scheme).get()).docs.map(d=>({id:d.id,...d.data()}));assert.equal(report.offerings.length,6);
  const students=sections.map((section,i)=>({name:`Temporary ${section} Student ${i+1}`,usn:`TB${Date.now()}${i}`,collegeEmail:`${prefix}-student${i+1}@demo.test`,phone:'0000000000',department:'ISE',semester:10,section,scheme,mentorEmail:'mentor@demo.test'}));
  await upload(admin.page,'students',students);
  for(const row of students){const account=await server.auth.getUserByEmail(row.collegeEmail);report.students.push({email:row.collegeEmail,uid:account.uid,section:row.section});assert.equal((await server.db.collection('enrollments').where('studentId','==',account.uid).get()).size,2);}
  let saved;
  for(let i=0;i<6;i++) {
    const teacher=await login(teachers[i].collegeEmail);await teacher.page.goto(`${base}/academic.html?emulator=1`);await teacher.page.locator('.class-button').waitFor();assert.equal(await teacher.page.locator('.class-button').count(),1);
    assert.match(await teacher.page.locator('.class-button').innerText(),new RegExp(`Sem 10 / ${sections[i]}`));await teacher.page.locator('.class-button').click();await teacher.page.locator('.marks-form').first().waitFor();assert.equal(await teacher.page.locator('.marks-form').count(),2);
    const text=await teacher.page.locator('#classContent').innerText();for(let j=0;j<students.length;j++)assert.equal(text.includes(students[j].name),sections[i]===sections[j]);
    if(i===0) {
      for(let j=0;j<2;j++){const form=teacher.page.locator('.marks-form').nth(j);await form.locator('[name="ia1"]').fill(String(j?27:19));await form.locator('[name="assignment"]').fill(String(j?9:6));const id=await form.getAttribute('data-id');await form.getByRole('button',{name:'Save marks'}).click();await teacher.page.waitForFunction(()=>![...document.querySelectorAll('.marks-form button')].some(b=>b.disabled));await server.db.doc(`marks/${id}`).get().then(d=>assert.equal(d.data().scores.ia1,j?27:19));}
      saved=(await server.db.collection('marks').where('teacherId','==',report.teachers[0].uid).get()).docs.map(d=>[d.id,JSON.stringify(d.data())]);assert.equal(saved.length,2);
    }
    await teacher.context.close();report.teachers[i].browserLogin=true;report.teachers[i].rosterSize=2;report.teachers[i].section=sections[i];
  }
  await upload(admin.page,'teachers',teachers);await upload(admin.page,'offerings',offerings);await upload(admin.page,'students',students);
  for(const [id,marks] of saved)assert.equal(JSON.stringify((await server.db.doc(`marks/${id}`).get()).data()),marks);
  for(const teacher of report.teachers)assert.equal((await server.db.collection('users').where('email','==',teacher.email).get()).size,1);
  assert.equal((await server.db.collection('offerings').where('scheme','==',scheme).get()).size,6);
  for(const student of report.students)assert.equal((await server.db.collection('enrollments').where('studentId','==',student.uid).get()).size,2);
  for(const student of report.students) {const client=await login(student.email);await client.page.locator('.subject-item').first().waitFor();assert.equal(await client.page.locator('.subject-item').count(),2);await client.context.close();}
  await upload(admin.page,'teachers',teachers,false);
  for(const width of [1920,1366,768,390]){await layout(admin.page,width);await admin.page.locator('#importPreview').scrollIntoViewIfNeeded();await admin.page.screenshot({path:fileURLToPath(new URL(`teacher-preview-${width}.png`,import.meta.url)),fullPage:true});}
  const after=await snapshot();for(const [path,data] of before)assert.equal(after.get(path),data,`Existing demo record changed: ${path}`);
  report.existingDemoDataUnchanged=true;report.marksPreserved=true;report.passed=true;await admin.context.close();assert.deepEqual(report.errors,[]);
  }
}catch(error){report.passed=false;report.error=error.stack;throw error;}
finally {await writeFile(new URL(previewOnly?'teacher-preview-results.json':'teacher-browser-results.json',import.meta.url),JSON.stringify(report,null,2));if(browser)await browser.close();await server.app.delete();console.log(JSON.stringify({passed:report.passed,prefix,teachers:report.teachers.length,error:report.error},null,2));}
