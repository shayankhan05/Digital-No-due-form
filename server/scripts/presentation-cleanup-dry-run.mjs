// This command has no apply mode and performs no production writes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {EJSON} from 'bson';
import dns from 'node:dns';
import {initializeApp,cert,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {planPresentationCleanup} from '../src/services/presentation-cleanup.js';
if(process.argv.includes('--apply'))throw Error('Production mutations require a separately approved manifest. This tool is dry-run only.');
if(!process.env.MONGODB_URI_FILE||!process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('Explicit production URI file and existing credential required.');
const raw=await readFile(process.env.MONGODB_URI_FILE,'utf8'),uri=(raw.match(/^\s*MONGODB_URI\s*=\s*(.+)\s*$/m)?.[1]||raw).trim().replace(/^(['"])(.*)\1$/,'$2');dns.setServers(['1.1.1.1']);
const client=new MongoClient(uri),credential=JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'));if(credential.project_id!=='digital-no-due-shayan')throw Error('Wrong existing Firebase project.');
const app=initializeApp({credential:cert(credential),projectId:credential.project_id});
try{
 await client.connect();const db=client.db(),snapshot={};for(const c of await db.listCollections().toArray())snapshot[c.name]=await db.collection(c.name).find({}).sort({_id:1}).toArray();
 const authUsers=[];let next;do{const page=await getAuth(app).listUsers(1000,next);authUsers.push(...page.users.map(u=>({uid:u.uid,email:u.email||'',displayName:u.displayName||'',disabled:u.disabled})));next=page.pageToken;}while(next);
 const dir='migration-output/presentation-release-'+Date.now();await mkdir(dir,{recursive:true});
 const backup=EJSON.stringify(snapshot,{relaxed:false}),hash=createHash('sha256').update(backup).digest('hex');await writeFile(dir+'/atlas-backup.ejson',backup,{flag:'wx'});if(createHash('sha256').update(await readFile(dir+'/atlas-backup.ejson')).digest('hex')!==hash)throw Error('Backup verification failed.');
 await writeFile(dir+'/auth-metadata.json',JSON.stringify(authUsers,null,2),{flag:'wx'});
 const plan=planPresentationCleanup(snapshot,authUsers),report={...plan,backup:{path:dir+'/atlas-backup.ejson',sha256:hash,counts:Object.fromEntries(Object.entries(snapshot).map(([c,rows])=>[c,rows.length]))}};
 await writeFile(dir+'/dry-run.json',JSON.stringify(report,null,2),{flag:'wx'});
 const lines=['# Production cleanup dry-run — NOT APPLIED','',`Backup SHA256: ${hash}`,'',JSON.stringify(plan.counts),'','## Identity changes','', '| Kind | UID | USN | Old name/email | Proposed name/email |','|---|---|---|---|---|',...plan.identities.map(i=>`| ${i.kind} | ${i.uid} | ${i.usn||''} | ${i.oldName} / ${i.oldEmail} | ${i.name} / ${i.email} |`),'','## Office mappings','',...plan.officeMappings.map(i=>`- ${i.department}: assign existing ${i.officeId}; current field empty.`),'','## Requests proposed for archived reset','',...plan.resetRequests.map(r=>`- ${r.name} / ${r.usn} / ${r.email}: ${r.requestId} (${r.status}); ${r.approvalIds.length} approvals, ${r.notificationIds.length} notifications, ${r.hallTicketIds.length} tickets, ${r.overrideIds.length} overrides.`),'','## Conflicts — excluded from automatic action','',...plan.conflicts.map(c=>'- '+JSON.stringify(c)),'',`Incomplete synthetic legacy profiles excluded: ${plan.excludedIncompleteProfiles.length}. Exact IDs are retained in the JSON manifest; no accounts will be created for them.`,'','Password resets: NONE. No production data has been changed. Approval of an exact manifest is required before any apply operation.'];
 await writeFile(dir+'/dry-run.md',lines.join('\n'),{flag:'wx'});console.log(JSON.stringify({report:dir+'/dry-run.md',manifest:dir+'/dry-run.json',counts:plan.counts,conflicts:plan.conflicts.length,backupVerified:true,productionWrites:0}));
}catch{console.error('Dry-run failed; no production writes were performed and no credentials are printed.');process.exitCode=1;}finally{await client.close();await deleteApp(app);}
