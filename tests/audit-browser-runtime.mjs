// Mutating browser regressions may never target the running demo or production.
import {readFile} from 'node:fs/promises';
import {localAdmin} from './bulk-fixture.mjs';
export const auditTarget=Object.freeze({projectId:'demo-digital-no-due-audit',firestorePort:8181,authPort:9200,functionsPort:5002});
export function assertAuditTarget(env=process.env){
  if(env.TEST_PROJECT_ID!==auditTarget.projectId || Number(env.TEST_FIRESTORE_PORT)!==8181 || Number(env.TEST_AUTH_PORT)!==9200)
    throw new Error('Mutating browser tests require demo-digital-no-due-audit on Firestore 8181/Auth 9200. The current demo is protected. Run only with isolated audit fixtures.');
}
export function auditAdmin(){assertAuditTarget();return localAdmin(auditTarget.projectId,8181,9200);}
export async function launchAuditBrowser(chromium,options){
  assertAuditTarget();
  const config=(await readFile(new URL('../js/firebase-config.js',import.meta.url),'utf8'))
    .replaceAll('demo-digital-no-due','demo-digital-no-due-audit').replaceAll(':9199',':9200')
    .replaceAll('8180','8181').replaceAll('5001','5002');
  const browser=await chromium.launch(options),newContext=browser.newContext.bind(browser);
  browser.newContext=async options=>{
    const context=await newContext(options);
    // Serve the unchanged application pages, with test-only Firebase endpoints.
    await context.route('**/js/firebase-config.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:config}));
    await context.route(/https?:\/\/(127\.0\.0\.1|localhost):(8180|9199|5001)\//,route=>route.abort('blockedbyclient'));
    return context;
  };
  return browser;
}
