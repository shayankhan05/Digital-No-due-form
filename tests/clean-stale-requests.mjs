// Explicit, narrowly scoped maintenance of the user's current local emulator.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {localAdmin} from './bulk-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.DEMO_PLAYWRIGHT_MODULE || 'playwright');
const verifyOnly=process.argv.includes('--verify-only');
const server=localAdmin('demo-digital-no-due',8180,9199),base='http://127.0.0.1:5050',report=verifyOnly?JSON.parse(await readFile(new URL('stale-requests-cleanup-results.json',import.meta.url),'utf8')):{removed:[],preservedIssued:[],browser:[]};report.browser=[];let browser;
async function snapshot(){const docs=new Map();async function visit(c){for(const d of (await c.get()).docs){docs.set(d.ref.path,d);for(const sub of await d.ref.listCollections())await visit(sub);}}for(const c of await server.db.listCollections())await visit(c);return docs;}
async function login(email){const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(45000);await page.goto(`${base}/login.html`);await page.locator('#email').fill(email);await page.locator('#password').fill('DemoPassword123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(/.*-dashboard\.html/);return {context,page};}
try{
  const before=await snapshot(),ayesha=(await server.auth.getUserByEmail('ise-demo-1ay24is158@demo.test')).uid;
  const ayeshaRequests=[...before.values()].filter(d=>/^noDueRequests\/[^/]+$/.test(d.ref.path)&&d.data().studentId===ayesha);
  assert.ok(ayeshaRequests.some(d=>d.data().status==='pending_stage1'),'Ayesha must have her valid pending request before cleanup.');
  const fixture=before.get('students/s1')?.data();assert.equal(fixture?.name,'s1');assert.equal(fixture?.usn,'USNs1');
  const roots=[...before.values()].filter(d=>/^noDueRequests\/[^/]+$/.test(d.ref.path)&&d.data().studentId==='s1'&&d.data().studentName==='s1'&&d.data().usn==='USNs1');
  const stale=roots.filter(d=>!d.data().issuedAt&&!['issued','cleared'].includes(d.data().status));
  report.preservedIssued=roots.filter(d=>!stale.includes(d)).map(d=>d.ref.path);
  const ids=new Set(stale.map(d=>d.id));
  const removal=[...before.values()].filter(d=>stale.some(root=>d.ref.path===root.ref.path||d.ref.path.startsWith(root.ref.path+'/')) || /^users\/[^/]+\/notifications\/[^/]+$/.test(d.ref.path)&&ids.has(d.data().requestId)&&d.data().studentId==='s1');
  assert.ok(removal.every(d=>!d.ref.path.toLowerCase().includes('hallticket')));assert.ok(removal.length<500);
  if(!verifyOnly)await writeFile(new URL('stale-requests-before-results.json',import.meta.url),JSON.stringify(Object.fromEntries([...before].map(([path,d])=>[path,d.data()])),null,2));
  // Check update times in the same atomic operation: never remove a changed request.
  if(verifyOnly)assert.equal(removal.length,0);else if(removal.length){const batch=server.db.batch();for(const d of removal)batch.delete(d.ref,{lastUpdateTime:d.updateTime});await batch.commit();}
  if(!verifyOnly){report.removed=removal.map(d=>d.ref.path);report.requestsRemoved=stale.map(d=>({id:d.id,...d.data()}));}
  const after=await snapshot();for(const [path,d]of before){if(report.removed.includes(path)){assert.equal(after.has(path),false);continue;}assert.deepEqual(after.get(path)?.data(),d.data(),`Unrelated data changed: ${path}`);}
  assert.equal(after.size,before.size-removal.length);
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  for(const role of ['accounts','library']){
    const actor=await login(`${role}@demo.test`);await actor.page.goto(`${base}/approver-dashboard.html#requests`);
    const pending=ayeshaRequests.find(d=>d.data().status==='pending_stage1'),needsApproval=pending.data().approvalStates[role]==='pending';
    if(needsApproval)await actor.page.locator(`[data-path="noDueRequests/${pending.id}/approvals/${role}"]`).waitFor();
    else await actor.page.getByText('No pending approvals right now.',{exact:false}).waitFor();
    const content=await actor.page.locator('#content').innerText();if(needsApproval){assert.ok(content.includes('Ayesha Siddiqui'));assert.ok(content.includes('1AY24IS158'));}assert.ok(!content.includes('USNs1'));
    const rows=await actor.page.locator('[data-path]').evaluateAll(rows=>rows.map(r=>({path:r.dataset.path,text:r.textContent,approveEnabled:!r.querySelector('.approve-btn')?.disabled})));
    assert.ok(rows.every(r=>!r.text.includes('USNs1')));assert.ok(rows.filter(r=>r.text.includes('1AY24IS158')).every(r=>r.approveEnabled));
    report.browser.push({role,noSyntheticPending:true,ayeshaVisible:needsApproval,approvalAvailable:needsApproval,ayeshaApprovalState:pending.data().approvalStates[role],rows:rows.map(r=>r.path)});
    await actor.page.screenshot({path:fileURLToPath(new URL(`stale-requests-${role}.png`,import.meta.url)),fullPage:true});await actor.context.close();
  }
  const student=await login('ise-demo-1ay24is158@demo.test');await student.page.getByText('Ayesha Siddiqui',{exact:false}).first().waitFor();await student.page.getByText('Library',{exact:false}).first().waitFor();report.studentDashboard=await student.page.locator('#content').innerText();assert.ok(report.studentDashboard.includes('1AY24IS158'));await student.context.close();
  // Read-only workflow check: leave all pending decisions to the user.
  for(const d of ayeshaRequests){assert.deepEqual((await server.db.doc(d.ref.path).get()).data(),d.data());const pending=d.data();assert.ok(pending.approvalItems.accounts&&pending.approvalItems.library);}
  const original=JSON.parse(await readFile(new URL('stale-requests-before-results.json',import.meta.url),'utf8')),final=await snapshot();
  for(const [path,data]of Object.entries(original)){
    if(report.removed.includes(path)){assert.equal(final.has(path),false);continue;}
    const current=JSON.parse(JSON.stringify(final.get(path)?.data()));
    // Normal student login refreshes only the derived clearance-plan timestamp.
    if(path===`students/${ayesha}/clearance/plan`){delete current.updatedAt;const {updatedAt,...plan}=data;assert.deepEqual(current,plan);}
    else assert.deepEqual(current,data,`Unexpected change after browser checks: ${path}`);
  }
  assert.equal(final.size,Object.keys(original).length-report.removed.length);report.postBrowserPreservationVerified=true;
  delete report.error;report.ayeshaRequests=ayeshaRequests.map(d=>d.id);report.otherDataUnchanged=true;report.passed=true;
  console.log(JSON.stringify({requestsRemoved:report.requestsRemoved.length,documentsRemoved:report.removed.length,preservedIssued:report.preservedIssued,ayeshaRequests:report.ayeshaRequests,browser:report.browser,passed:true},null,2));
}catch(error){report.passed=false;report.error=error.stack;throw error;}finally{await writeFile(new URL('stale-requests-cleanup-results.json',import.meta.url),JSON.stringify(report,null,2));await browser?.close();await server.app.delete();}
