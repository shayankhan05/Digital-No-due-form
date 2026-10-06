// Workflow acceptance checks against isolated audit fixtures only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {auditAdmin,launchAuditBrowser} from './audit-browser-runtime.mjs';
import {enrollmentPlan} from '../functions/clearance.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.DEMO_PLAYWRIGHT_MODULE || 'playwright');
const server=auditAdmin(),base='http://127.0.0.1:5050',report={browserErrors:[],dialogs:[],teachers:[],students:[],migrations:[]};let browser;
async function snapshot(){const data={};async function visit(c){for(const d of (await c.get()).docs){data[d.ref.path]=d.data();for(const sub of await d.ref.listCollections())await visit(sub);}}for(const c of await server.db.listCollections())await visit(c);return data;}
async function authState(){const rows={};let token;do{const batch=await server.auth.listUsers(1000,token);for(const u of batch.users)rows[u.uid]=createHash('sha256').update(JSON.stringify({email:u.email,passwordHash:u.passwordHash,passwordSalt:u.passwordSalt,disabled:u.disabled,customClaims:u.customClaims})).digest('hex');token=batch.pageToken;}while(token);return rows;}
async function login(email){const context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>report.browserErrors.push(e.message));page.on('dialog',async d=>{report.dialogs.push(d.message());await d.accept();});await page.goto(`${base}/login.html`);await page.locator('#email').fill(email);await page.locator('#password').fill('DemoPassword123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(/.*-dashboard\.html/);return {context,page};}
async function current(id){return (await server.db.doc(`noDueRequests/${id}`).get()).data();}
async function waitStatus(id,status){for(let i=0;i<120;i++){if((await current(id)).status===status)return;await new Promise(r=>setTimeout(r,250));}throw new Error(`Request did not reach ${status}: ${JSON.stringify(await current(id))}`);}
async function queue(actor){await actor.page.goto(`${base}/approver-dashboard.html#requests`);await actor.page.waitForFunction(()=>document.querySelector('#content')?.textContent.includes('pending') || document.querySelector('[data-path]'));}
async function approveItem(actor,id,key){const row=actor.page.locator(`[data-path="noDueRequests/${id}/approvals/${key}"]`);await row.waitFor();await row.locator('.approve-btn').click();for(let i=0;i<120;i++){if((await current(id)).approvalStates[key]==='approved')return;await new Promise(r=>setTimeout(r,250));}throw new Error(`Approval failed ${key}`);}
try{
  const before=await snapshot(),beforeAuth=await authState();await writeFile(new URL('current-subject-workflow-before-results.json',import.meta.url),JSON.stringify({firestore:before,auth:beforeAuth},null,2));
  browser=await launchAuditBrowser(chromium,{headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const admin=await login('admin@demo.test');
  const candidates=new Set(Object.entries(before).filter(([path,s])=>/^students\/[^/]+$/.test(path) && s.department==='ISE' && Number(s.semester)===5 && String(s.scheme)==='2022').map(([path])=>path.split('/')[1]));
  for(const [path,r] of Object.entries(before))if(/^noDueRequests\/[^/]+$/.test(path)&& !['issued','cleared'].includes(r.status))candidates.add(r.studentId);
  for(const uid of candidates){const result=await admin.page.evaluate(async uid=>{const {functions}=await import('/js/firebase-config.js'),{httpsCallable}=await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js');try{return (await httpsCallable(functions,'studentWorkflow')({studentUid:uid})).data;}catch(error){return {error:error.message};}},uid);report.migrations.push({uid,migrated:result.migrated,error:result.error});if(result.error)throw new Error(`Workflow refresh failed ${uid}: ${result.error}`);}
  console.log(`Current academic plans refreshed: ${candidates.size}`);
  const email='ise-demo-1ay24is102@demo.test',uid=(await server.auth.getUserByEmail(email)).uid,plan=await enrollmentPlan(server.db,uid),student=await login(email);
  await student.page.getByRole('heading',{name:'My Subjects & Teachers'}).waitFor();const cards=student.page.locator('.subject-item');assert.equal(await cards.count(),Object.values(plan.items).filter(i=>i.teacherUid).length);
  for(const item of Object.values(plan.items).filter(i=>i.teacherUid)){const card=cards.filter({hasText:item.subjectCode});assert.equal(await card.count(),1);const text=await card.innerText();assert.ok(text.includes(item.teacherName));assert.ok(text.includes(item.teacherEmail));assert.ok(text.includes('Section B'));}
  report.studentTeacherDisplay=true;report.subjects=Object.entries(plan.items).filter(([,i])=>i.teacherUid).map(([key,i])=>({key,...i}));
  await student.page.goto(`${base}/create-request.html`);await student.page.locator('#confirmCheck').check();await student.page.locator('#submitBtn').click();await student.page.waitForURL(/student-dashboard/);
  const requests=await server.db.collection('noDueRequests').where('studentId','==',uid).get(),created=requests.docs.filter(d=>!before[d.ref.path]);assert.equal(created.length,1);const id=created[0].id;report.requestId=id;
  assert.deepEqual((await current(id)).approvalItems,plan.items);assert.equal((await server.db.doc(`noDueRequests/${id}`).collection('approvals').get()).size,Object.keys(plan.items).length);
  const teacherEmails=['aarav.mehta@demo.test','nida.farooq@demo.test','rohit.kulkarni@demo.test','sana.mir@demo.test','vivek.reddy@demo.test'],actors=new Map();
  for(const email of [...new Set([...teacherEmails,...Object.values(plan.items).filter(i=>i.teacherEmail).map(i=>i.teacherEmail)])]){
    const actor=await login(email);actors.set(email,actor);await queue(actor);const teacherUid=(await server.auth.getUserByEmail(email)).uid,expected=Object.entries(plan.items).filter(([,i])=>i.teacherUid===teacherUid).map(([key])=>`noDueRequests/${id}/approvals/${key}`).sort();
    if(expected.length)await actor.page.waitForFunction(({id,count})=>document.querySelectorAll(`[data-path^="noDueRequests/${id}/approvals/"]`).length===count,{id,count:expected.length});
    const visible=await actor.page.locator(`[data-path^="noDueRequests/${id}/approvals/"]`).evaluateAll(rows=>rows.map(r=>r.dataset.path));assert.deepEqual(visible.sort(),expected);report.teachers.push({email,visibleApprovalCount:visible.length,exactScope:true});
  }
  const reject=Object.entries(plan.items).find(([,i])=>i.subjectCode==='BCS514'),rejectActor=actors.get(reject[1].teacherEmail),row=rejectActor.page.locator(`[data-path="noDueRequests/${id}/approvals/${reject[0]}"]`);
  await row.locator('.reject-btn').click();await row.getByRole('textbox',{name:'Reason for rejection'}).fill('Assignment pending — subject mapping acceptance test');await row.locator('.reject-btn').click();await waitStatus(id,'rejected');
  await student.page.reload();await student.page.locator('#resubmitBtn').waitFor();const rejectionText=await student.page.locator('#content').innerText();for(const text of [reject[1].teacherName,reject[1].subjectCode,reject[1].subjectName,'Assignment pending'])assert.ok(rejectionText.includes(text));
  const notification=(await server.db.collection(`users/${uid}/notifications`).where('requestId','==',id).get());assert.equal(notification.size,1);assert.equal(notification.docs[0].data().reason,'Assignment pending — subject mapping acceptance test');
  await student.page.locator('#resubmitBtn').click();await waitStatus(id,'pending_stage1');report.rejectionAndResubmission=true;
  for(const type of ['library','accounts']){const user=(await server.db.doc(`users/${plan.items[type].approverId}`).get()).data(),actor=await login(user.email);await queue(actor);await approveItem(actor,id,type);await actor.context.close();assert.equal((await current(id)).status,'pending_stage1');}
  for(const [key,item] of Object.entries(plan.items).filter(([,i])=>i.teacherUid)){const actor=actors.get(item.teacherEmail);await queue(actor);await approveItem(actor,id,key);}
  await waitStatus(id,'pending_mentor');
  for(const [role,owner,next] of [['mentor','mentorId','pending_hod'],['hod','hodId','cleared']]){const user=(await server.db.doc(`users/${plan[owner]}`).get()).data(),actor=await login(user.email);await actor.page.goto(`${base}/${role}-dashboard.html#requests`);const row=actor.page.locator(`[data-request-id="${id}"]`);await row.waitFor();await row.locator('.approve-btn').click();await waitStatus(id,next);await actor.context.close();}
  const officeUser=(await server.db.doc(`users/${plan.officeId}`).get()).data(),office=await login(officeUser.email);const issue=office.page.locator(`[data-request-id="${id}"]`);await issue.waitFor();await issue.click();await waitStatus(id,'issued');await student.page.reload();await student.page.getByText('Hall ticket issued',{exact:false}).first().waitFor();report.fullWorkflowIssued=true;
  const final=await snapshot();assert.deepEqual(await authState(),beforeAuth);
  for(const [path,data] of Object.entries(before)){
    assert.ok(final[path],`Deleted existing record: ${path}`);
    try{assert.deepEqual(final[path],data);continue;}catch{}
    if(/^students\/[^/]+\/clearance\/plan$/.test(path))continue;
    if(/^noDueRequests\/[^/]+$/.test(path)&&final[path].workflowHistory){assert.deepEqual(final[path].workflowHistory.approvalItems,data.approvalItems || final[path].workflowHistory.approvalItems);continue;}
    if(/^noDueRequests\/[^/]+\/approvals\/[^/]+$/.test(path)&&final[path].historicalApproval){assert.deepEqual(final[path].historicalApproval,data);continue;}
    assert.deepEqual(final[path],data,`Overwrote existing data: ${path}`);
  }
  for(const section of ['A','B','C']){const students=(await server.db.collection('students').where('department','==','ISE').where('semester','==',5).where('section','==',section).get()).docs.filter(d=>String(d.data().scheme)==='2022');const sample=students.find(d=>d.data().email?.startsWith('ise-demo-')),actor=await login(sample.data().email);await actor.page.locator('.subject-item').first().waitFor();report.students.push({section,subjectCount:await actor.page.locator('.subject-item').count(),teacherDisplay:true});await actor.page.setViewportSize({width:390,height:844});assert.equal(await actor.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await actor.context.close();}
  report.preserved={marks:true,students:true,offerings:true,enrollments:true,auth:true,existingRequestHistory:true};assert.deepEqual(report.browserErrors,[]);report.passed=true;console.log(JSON.stringify({passed:true,requestId:id,subjects:report.subjects.map(i=>i.subjectCode),teachers:report.teachers},null,2));
}catch(error){report.passed=false;report.error=error.stack;throw error;}finally{await writeFile(new URL('current-subject-workflow-browser-results.json',import.meta.url),JSON.stringify(report,null,2));if(browser)await browser.close();await server.app.delete();}
