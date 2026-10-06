import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertAuditTarget,launchAuditBrowser} from './audit-browser-runtime.mjs';
test('mutating browser tooling rejects the main demo and missing audit configuration',()=>{
  assert.throws(()=>assertAuditTarget({}),/current demo is protected/);
  assert.throws(()=>assertAuditTarget({TEST_PROJECT_ID:'demo-digital-no-due',TEST_FIRESTORE_PORT:'8180',TEST_AUTH_PORT:'9199'}),/current demo is protected/);
  assert.doesNotThrow(()=>assertAuditTarget({TEST_PROJECT_ID:'demo-digital-no-due-audit',TEST_FIRESTORE_PORT:'8181',TEST_AUTH_PORT:'9200'}));
});
test('all six mutating browser regressions use audit Admin and browser endpoints',async()=>{
  for(const file of ['current-subject-workflow-browser.mjs','offering-mapping-browser.mjs','runtime-import-browser.mjs','runtime-sections-browser.mjs','teacher-browser.mjs','template-offerings-browser.mjs']){
    const source=await readFile(new URL(file,import.meta.url),'utf8');assert.match(source,/auditAdmin\(\)/);assert.match(source,/launchAuditBrowser\(chromium,/);assert.doesNotMatch(source,/localAdmin\('demo-digital-no-due',8180,9199\)/);
  }
});
test('every browser context replaces Firebase configuration and blocks current-emulator endpoints',async()=>{
  const previous={...process.env};Object.assign(process.env,{TEST_PROJECT_ID:'demo-digital-no-due-audit',TEST_FIRESTORE_PORT:'8181',TEST_AUTH_PORT:'9200'});
  try{const routes=[],context={route:async(pattern,handler)=>routes.push({pattern,handler})},mockBrowser={newContext:async()=>context};
    const browser=await launchAuditBrowser({launch:async()=>mockBrowser},{});await browser.newContext();assert.equal(routes.length,2);
    let response;await routes[0].handler({fulfill:async r=>{response=r;}});assert.match(response.body,/projectId: "demo-digital-no-due-audit"/);assert.match(response.body,/:9200/);assert.match(response.body,/8181/);assert.match(response.body,/5002/);assert.doesNotMatch(response.body,/:9199|8180|5001/);
    for(const port of [8180,9199,5001])assert.ok(routes[1].pattern.test(`http://127.0.0.1:${port}/path`));let blocked;await routes[1].handler({abort:async reason=>{blocked=reason;}});assert.equal(blocked,'blockedbyclient');
  }finally{for(const key of ['TEST_PROJECT_ID','TEST_FIRESTORE_PORT','TEST_AUTH_PORT']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
