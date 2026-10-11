// Read-only acceptance checks. Never creates requests, imports CSV or changes passwords.
import {MongoClient} from 'mongodb';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const client=new MongoClient('mongodb://127.0.0.1:27017/digital_no_due_dev?replicaSet=rs0');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 await client.connect();const db=client.db(),saved=JSON.parse(await readFile('server/test/current-preservation-before.json','utf8'));
 const report={accounts:[],layouts:[],preserved:{}};
 for(const [name,rows]of Object.entries(saved)){const current=await db.collection(name).find({}).sort({_id:1}).toArray();assert.equal(JSON.stringify(current),JSON.stringify(rows),name+' changed');report.preserved[name]=current.length;}
 const exported=JSON.parse(await readFile('server/auth-emulator-backup/auth_export/accounts.json','utf8'));
 const authEmails=new Set((exported.users||[]).map(u=>u.email));const teachers=await db.collection('users').find({role:'subject_faculty'}).toArray(),teacher=teachers.find(t=>authEmails.has(t.email));assert.ok(teacher);
 const logins=['admin@demo.test','student@demo.test',teacher.email,'mentor@demo.test','hod@demo.test','office@demo.test','library@demo.test','accounts@demo.test','ise-demo-1ay24is158@demo.test','1ay24is158','sana.mir@demo.test','fac204'];
 await mkdir('server/test/browser-artifacts',{recursive:true});
 for(const identifier of logins){const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(25000);await page.goto('http://127.0.0.1:5050/login.html');assert.equal(await page.locator('label[for=email]').innerText(),'Email / USN / Employee ID');await page.locator('#email').fill(identifier);await page.locator('#password').fill('DemoPassword123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(/dashboard/);report.accounts.push({identifier,url:page.url(),password:'DemoPassword123!'});
  for(const width of [1920,1366,1024,768,390]){await page.setViewportSize({width,height:900});await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),identifier+' overflow '+width);report.layouts.push({identifier,width,passed:true});}
  if(identifier==='1ay24is158'){await page.locator('.subject-item').first().waitFor();await page.screenshot({path:'server/test/browser-artifacts/student-mobile.png'});await page.goto('http://127.0.0.1:5050/academic.html');await page.getByRole('heading',{name:'Subjects & Marks'}).waitFor();assert.ok(await page.locator('.academic-subject').count()>0);}
  if(identifier==='sana.mir@demo.test'){await page.goto('http://127.0.0.1:5050/academic.html');await page.locator('.class-button').first().click();await page.locator('#exportMarksBtn').waitFor();await page.locator('.marks-csv-card summary').click();await page.locator('#marksOverview table').waitFor();assert.ok(await page.locator('#marksOverview tbody tr').count()>1);await page.screenshot({path:'server/test/browser-artifacts/teacher-mobile.png'});}
  await context.close();
 }
 await writeFile('server/test/browser-artifacts/current-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await client.close();}
