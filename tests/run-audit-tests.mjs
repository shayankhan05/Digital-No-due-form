import {spawn} from 'node:child_process';
// Never clear the currently running browser demo. The security suite uses this isolated project.
const env={...process.env,TEST_PROJECT_ID:'demo-digital-no-due-audit',TEST_FIRESTORE_PORT:'8181',TEST_AUTH_PORT:'9200'};
for(const files of [['workflow.test.mjs','security.test.mjs','template-links.test.mjs'],['provisioning.test.mjs']]) {
  const child=spawn(process.execPath,['--loader','./firebase-loader.mjs','--test',...files],{stdio:'inherit',env});
  const code=await new Promise(resolve=>{child.on('error',()=>resolve(1));child.on('exit',resolve);});
  if(code!==0) process.exit(code || 1);
}
