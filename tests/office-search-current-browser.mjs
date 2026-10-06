// Read-only acceptance against the current demo; never submit/issue/edit records.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {localAdmin} from './bulk-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.DEMO_PLAYWRIGHT_MODULE||'C:/Users/Hp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const server=localAdmin('demo-digital-no-due',8180,9199),report={queries:[],layouts:[],errors:[]};let browser;
async function snapshot(){const rows=new Map();async function visit(c){for(const d of (await c.get()).docs){rows.set(d.ref.path,d.data());for(const sub of await d.ref.listCollections())await visit(sub);}}for(const c of await server.db.listCollections())await visit(c);return rows;}
try{
  const before=await snapshot();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto('http://127.0.0.1:5050/login.html');await page.locator('#email').fill('office@demo.test');await page.locator('#password').fill('DemoPassword123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(/office-dashboard/);
  for(const term of ['Ayesha','AYESHA','Ayesha Siddiqui','Sid','1AY24IS158','ise-demo-1ay24is158@demo.test']){
    await page.locator('#usnInput').fill(term);await page.locator('#searchBtn').click();await page.getByText('1 student found'+(term.includes('@')||term==='1AY24IS158'?'':' with this name'),{exact:true}).waitFor();assert.match(await page.locator('#searchResult').innerText(),/Ayesha Siddiqui/);report.queries.push({term,count:1});
  }
  const currentRequest=[...before.entries()].filter(([path,row])=>/^noDueRequests\/[^/]+$/.test(path)&&row.usn==='1AY24IS158').sort((a,b)=>(b[1].createdAt?.seconds||0)-(a[1].createdAt?.seconds||0))[0][1];
  await page.locator('.office-view-request').click();await page.locator('#searchedIssueBtn').waitFor();assert.equal(await page.locator('#searchedIssueBtn').isDisabled(),currentRequest.status!=='cleared');report.existingIssuanceEligibilityPreserved=true;
  for(const width of [1920,1366,768,390]){await page.setViewportSize({width,height:900});const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,shell:document.querySelector('.app-shell').getBoundingClientRect().width}));assert.ok(metrics.scroll<=width);report.layouts.push(metrics);}
  await page.locator('#officeSection').fill('A');await page.locator('#searchBtn').click();await page.getByText('0 students found',{exact:true}).waitFor();report.zeroFilter=true;
  await page.locator('#officeSection').fill('');await page.locator('#usnInput').fill('1AY24IS102');await page.locator('#searchBtn').click();await page.getByText('1 student found',{exact:true}).waitFor();assert.match(await page.locator('#searchResult').innerText(),/Hall Ticket: Issued/);report.issuedHistoryVisible=true;
  const after=await snapshot();assert.equal(after.size,before.size);for(const [path,data]of before)assert.deepEqual(after.get(path),data,path);report.currentDataUnchanged=true;assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify(report,null,2));
}catch(error){report.passed=false;report.error=error.stack;throw error;}finally{await writeFile(new URL('office-search-current-browser-results.json',import.meta.url),JSON.stringify(report,null,2));await browser?.close();await server.app.delete();}
