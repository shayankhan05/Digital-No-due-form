// Read-only real Chrome layout audit. No imports, saves, approvals or resets.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {localAdmin} from './bulk-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.DEMO_PLAYWRIGHT_MODULE || 'playwright');
const baseline=process.argv.includes('--baseline'),base='http://127.0.0.1:5050';
const server=localAdmin('demo-digital-no-due',8180,9199),report={baseline,checks:[],blockedMutations:[],errors:[]};
const widths=[1920,1366,768,390];let browser;
async function databaseSnapshot() {
  const docs=[];
  async function visit(collection) {
    const snap=await collection.get();
    for(const doc of snap.docs) {docs.push([doc.ref.path,doc.data()]);for(const child of await doc.ref.listCollections())await visit(child);}
  }
  for(const collection of await server.db.listCollections())await visit(collection);
  return createHash('sha256').update(JSON.stringify(docs.sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
}
async function measure(page,label,width,theme='light') {
  // Allow existing theme transitions to finish before comparing paint values.
  await page.waitForTimeout(300);
  const metrics=await page.evaluate(()=>{
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
    const overflows=[...document.querySelectorAll('.app-content,.card,.row,.subject-grid,.top-bar,form')].filter(visible).filter(e=>!e.matches('.profile-summary-card')&&e.scrollWidth>e.clientWidth+2).map(e=>({tag:e.tagName,id:e.id,class:e.className,client:e.clientWidth,scroll:e.scrollWidth}));
    const subjects=[...document.querySelectorAll('.subject-item')].filter(visible).map(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1;});
    const buttons=[...document.querySelectorAll('.provision-actions button')].map(e=>e.getBoundingClientRect());
    const overlap=buttons.length===2 && Math.min(buttons[0].right,buttons[1].right)>Math.max(buttons[0].left,buttons[1].left)+1 && Math.min(buttons[0].bottom,buttons[1].bottom)>Math.max(buttons[0].top,buttons[1].top)+1;
    const nav=document.querySelector('.bottom-nav'),content=document.querySelector('.app-content');
    const navCoversContent=Boolean(nav&&content&&content.getBoundingClientRect().bottom>nav.getBoundingClientRect().top+1);
    const shell=document.querySelector('.app-shell');
    const frame=shell||document.querySelector('.login-wrap');
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,top:r.top,bottom:r.bottom};};
    const frameBounds=frame?rect(frame):null,loginCard=document.querySelector('.login-card'),footer=document.querySelector('.login-wrap > .helper');
    const admin=Boolean(document.querySelector('script[src="js/institutional-admin.js"],script[src="js/admin.js"]'));
    const expectedWidth=innerWidth<=520?innerWidth:Math.min(innerWidth,admin?1040:480);
    const frameContained=Boolean(frameBounds&&Math.abs(frameBounds.width-expectedWidth)<=2&&Math.abs(frameBounds.left-(innerWidth-expectedWidth)/2)<=2);
    const navContained=!nav||Boolean(frameBounds&&nav.getBoundingClientRect().left>=frameBounds.left-1&&nav.getBoundingClientRect().right<=frameBounds.right+1);
    const loginCompact=!loginCard||loginCard.getBoundingClientRect().width<=360+1;
    const footerBelow=!footer||footer.getBoundingClientRect().top>=loginCard.getBoundingClientRect().bottom;
    const hiddenBottom=Boolean(shell&&shell.getBoundingClientRect().bottom>innerHeight+2);
    const styles={};for(const selector of ['body','.card','.btn-primary','.top-bar','.subject-item','.subject-info strong']) {const e=document.querySelector(selector);if(e){const s=getComputedStyle(e);styles[selector]=Object.fromEntries(['color','backgroundColor','fontFamily','fontSize','fontWeight','borderColor','borderRadius','boxShadow'].map(k=>[k,s[k]]));}}
    const tables=[...document.querySelectorAll('table')].map(e=>({scrollContainer:Boolean(e.closest('.table-scroll')),width:e.getBoundingClientRect().width}));
    return {frameBounds,frameContained,navContained,loginCompact,footerBelow,documentOverflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)>innerWidth+2,overflows,subjectsContained:subjects.every(Boolean),buttonOverlap:overlap,navCoversContent,hiddenBottom,styles,tables};
  });
  const check={label,width,theme,...metrics};report.checks.push(check);
  if(!baseline) {
    assert.equal(metrics.frameContained,true,`${label} ${width} frame width/centering`);
    assert.equal(metrics.navContained,true,`${label} ${width} navigation escapes frame`);
    assert.equal(metrics.loginCompact,true,`${label} ${width} stretched login card`);
    assert.equal(metrics.footerBelow,true,`${label} ${width} footer beside/overlapping login`);
    assert.equal(metrics.documentOverflow,false,`${label} ${width} page overflow`);
    assert.deepEqual(metrics.overflows,[],`${label} ${width} container overflow`);
    assert.equal(metrics.subjectsContained,true,`${label} subjects escape grid`);assert.equal(metrics.buttonOverlap,false,'Provisioning buttons overlap');
    assert.equal(metrics.navCoversContent,false,`${label} bottom nav overlaps content`);assert.equal(metrics.hiddenBottom,false,`${label} shell extends below viewport`);
    assert.ok(metrics.tables.every(t=>t.scrollContainer),`${label} table lacks scroll container`);
  }
}
async function context(email) {
  const c=await browser.newContext({viewport:{width:1366,height:900}});
  // Baseline original CSS without reverting files or changing the running app.
  if(baseline)await c.route('**/css/style.css',async route=>{const css=await readFile(new URL('../css/style.css',import.meta.url),'utf8');await route.fulfill({contentType:'text/css',body:css.split('/* Layout containment only:')[0]});});
  await c.route('http://127.0.0.1:5001/**',async route=>{const action=route.request().postDataJSON()?.data?.action;if(!['policy','directory','previewAccounts','previewOfferings'].includes(action)){report.blockedMutations.push(action);return route.abort();}return route.continue();});
  const page=await c.newPage();page.setDefaultTimeout(45000);page.on('dialog',d=>d.dismiss());page.on('pageerror',e=>report.errors.push({email,error:e.message}));
  if(email) {await page.goto(`${base}/login.html?emulator=1`,{waitUntil:'load'});await page.locator('#email').fill(email);await page.locator('#password').fill('DemoPassword123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(/.*-dashboard\.html/);}
  return {c,page};
}
async function loaded(page) {await page.waitForFunction(()=>{const e=document.getElementById('content');return !e||e.textContent.trim()&&!/^Loading/.test(e.textContent.trim());});}
try {
  const dataBefore=await databaseSnapshot();
  const businessFiles=['../js/student.js','../js/academic.js','../js/academic-page.js','../js/institutional-admin.js','../js/admin.js','../functions/provisioning.js','../firestore.rules'];
  const hashes=Object.fromEntries(await Promise.all(businessFiles.map(async path=>[path,createHash('sha256').update(await readFile(new URL(path,import.meta.url))).digest('hex')])));
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const guest=await context();for(const width of widths){await guest.page.setViewportSize({width,height:900});await guest.page.goto(`${base}/login.html?emulator=1`,{waitUntil:'load'});await measure(guest.page,'login',width);await guest.page.screenshot({path:fileURLToPath(new URL(`responsive-${baseline?'before':'after'}-login-${width}.png`,import.meta.url)),fullPage:true});}await guest.c.close();
  const routes=[
    ['ise-demo-1ay24is156@demo.test',[['student-dashboard.html','student dashboard'],['academic.html','student academic']]],
    ['ise-ab-faculty@demo.test',[['academic.html','teacher academic'],['approver-dashboard.html','approver dashboard']]],
    ['mentor@demo.test',[['mentor-dashboard.html','mentor dashboard'],['academic.html','mentor academic']]],
    ['hod@demo.test',[['hod-dashboard.html','HOD dashboard']]],
    ['office@demo.test',[['office-dashboard.html','office dashboard']]],
    ['admin@demo.test',[['admin-dashboard.html','admin provisioning'],['advanced-admin.html','advanced admin']]]
  ];
  for(const [email,pages] of routes) {
    const client=await context(email);
    for(const width of widths)for(const [path,label] of pages) {
      await client.page.setViewportSize({width,height:900});await client.page.goto(`${base}/${path}?emulator=1`,{waitUntil:'load'});await loaded(client.page);
      if(label==='teacher academic'){await client.page.locator('.class-button').first().click();await client.page.locator('.marks-form').first().waitFor();}
      await measure(client.page,label,width);
      if(label==='admin provisioning') {
        await client.page.locator('#importType').selectOption('offerings');await client.page.locator('#importFile').setInputFiles(fileURLToPath(new URL('../templates/local-test-offerings.csv',import.meta.url)));await client.page.locator('#previewBtn').click();await client.page.waitForFunction(()=>!document.getElementById('previewBtn').disabled&&document.getElementById('importPreview').textContent.includes('rows uploaded'));await measure(client.page,'bulk CSV preview',width);
      }
      if(label==='advanced admin')for(const key of ['subjects','offerings','enrollments','assignments','users']) {
        await client.page.locator(`.tab[data-key="${key}"]`).click();await client.page.locator('#recordForm').waitFor();await client.page.waitForFunction(()=>document.getElementById('records').textContent.trim().length>0);await measure(client.page,`advanced ${key}`,width);
      }
      if([1920,390].includes(width) && ['student dashboard','admin provisioning','teacher academic'].includes(label)) {
        if(label==='admin provisioning'&&width===390)await client.page.locator('.provision-actions').scrollIntoViewIfNeeded();else await client.page.locator('#content').evaluate(e=>{e.scrollTop=0;});
        await client.page.screenshot({path:fileURLToPath(new URL(`responsive-${baseline?'before':'after'}-${label.replaceAll(' ','-')}-${width}.png`,import.meta.url)),fullPage:true});
      }
      // Verify the existing theme through its actual toggle (local browser state only).
      if(client.page.locator('#themeToggle').isVisible && await client.page.locator('#themeToggle').count()) {
        await client.page.locator('#themeToggle').click();await measure(client.page,label,width,'dark');await client.page.locator('#themeToggle').click();
      }
    }
    await client.c.close();
  }
  report.businessHashes=hashes;report.dataUnchanged=(await databaseSnapshot())===dataBefore;assert.equal(report.dataUnchanged,true,'Firestore data changed during read-only UI audit');assert.deepEqual(report.blockedMutations,[]);
  if(!baseline) {const before=JSON.parse(await readFile(new URL('responsive-baseline.json',import.meta.url),'utf8'));assert.deepEqual(hashes,before.businessHashes,'Business code changed during UI cleanup');for(const check of report.checks){const original=before.checks.find(c=>c.label===check.label&&c.width===check.width&&c.theme===check.theme);if(original)assert.deepEqual(check.styles,original.styles,`Theme changed: ${check.label} ${check.width} ${check.theme}`);}}
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;throw error;}
finally {
  await writeFile(new URL(baseline?'responsive-baseline.json':'responsive-results.json',import.meta.url),JSON.stringify(report,null,2));
  if(browser)await browser.close();await server.app.delete();console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,dataUnchanged:report.dataUnchanged,error:report.error},null,2));
}
