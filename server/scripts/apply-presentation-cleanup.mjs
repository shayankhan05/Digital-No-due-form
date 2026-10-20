// NEVER run until the human has approved the exact dry-run manifest.
// No automatic startup/deployment hook imports this operator command.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {EJSON} from 'bson';
import dns from 'node:dns';
import {initializeApp,cert,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {normalizeDemoIdentity} from '../src/services/presentation-identities.js';
import {archiveDemoWorkflow,recordDigest} from '../src/services/presentation-reset.js';
const option=name=>process.argv[process.argv.indexOf(name)+1],file=option('--manifest'),approved=option('--approved-manifest-sha256'),actorUid=option('--actor-uid');
if(!process.argv.includes('--apply')||!process.argv.includes('--manifest')||!process.argv.includes('--actor-uid')||!process.argv.includes('--approved-manifest-sha256')||!/^([a-f0-9]{64})$/.test(approved||'')||process.env.FIREBASE_AUTH_EMULATOR_HOST||!process.env.MONGODB_URI_FILE||!process.env.GOOGLE_APPLICATION_CREDENTIALS)throw Error('Explicit apply, reviewed manifest SHA256, existing Super Admin and production environment required.');
const manifestText=await readFile(file,'utf8');if(createHash('sha256').update(manifestText).digest('hex')!==approved)throw Error('Manifest does not match the approved digest.');
const plan=JSON.parse(manifestText);if(plan.version!==1||plan.mode!=='DRY_RUN_ONLY'||plan.passwordResets?.length)throw Error('Only the reviewed password-preserving cleanup format is supported.');
const backupText=await readFile(plan.backup.path,'utf8');if(createHash('sha256').update(backupText).digest('hex')!==plan.backup.sha256)throw Error('Backup verification failed.');
const original=EJSON.parse(backupText),raw=await readFile(process.env.MONGODB_URI_FILE,'utf8'),uri=(raw.match(/^\s*MONGODB_URI\s*=\s*(.+)\s*$/m)?.[1]||raw).trim().replace(/^(['"])(.*)\1$/,'$2'),credential=JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'));if(credential.project_id!=='digital-no-due-shayan')throw Error('Wrong Firebase project.');
dns.setServers(['1.1.1.1']);const client=new MongoClient(uri),app=initializeApp({credential:cert(credential),projectId:credential.project_id});
try{
 await client.connect();const database=client.db(),user=await database.collection('users').findOne({_id:actorUid,role:'super_admin'});if(!user||['inactive','exited','deleted'].includes(user.accountStatus))throw Error('Active existing Super Admin required.');const actor={...user,uid:user._id};
 const manifestId='presentation-manifest-'+approved,journal=await database.collection('presentationReleaseJournal').findOne({_id:manifestId});
 if(!journal){
  const fresh={};for(const name of Object.keys(original)){fresh[name]=await database.collection(name).find({}).sort({_id:1}).toArray();if(recordDigest(fresh[name])!==recordDigest(original[name]))throw Error('Production changed since dry-run. Generate and approve a new manifest.');}
  const path=file+'.pre-apply.ejson',text=EJSON.stringify(fresh,{relaxed:false});await writeFile(path,text,{flag:'wx'});if(recordDigest(EJSON.parse(await readFile(path,'utf8')))!==recordDigest(fresh))throw Error('Pre-apply backup verification failed.');
  await database.collection('presentationReleaseJournal').insertOne({_id:manifestId,state:'approved',actorId:actor.uid,manifestSha256:approved,backupReference:path,at:new Date()});
 }
 const backupReference=journal?.backupReference||file+'.pre-apply.ejson';
 // Archive request objects before identity presentation fields change so that
 // approved request digests remain exact and historical names remain available.
 await archiveDemoWorkflow({database,client,actor,manifest:plan.resetRequests,backupReference});
 for(const mapping of plan.identities)await normalizeDemoIdentity({database,client,auth:getAuth(app),actor,mapping,backupReference});
 for(const mapping of plan.officeMappings){const session=client.startSession();try{await session.withTransaction(async()=>{const old=await database.collection('departmentWorkflows').findOne({_id:mapping.departmentId},{session});if(old?.officeId===mapping.officeId)return;if(old?.officeId)throw Error('Never replace a non-empty Office mapping.');const office=await database.collection('users').findOne({_id:mapping.officeId,role:'office',scope:'department',departmentId:mapping.departmentId},{session});if(!office||['inactive','exited','deleted'].includes(office.accountStatus))throw Error('Existing Office is no longer eligible.');await database.collection('departmentWorkflows').updateOne({_id:mapping.departmentId},{$set:{officeId:mapping.officeId,departmentId:mapping.departmentId,officeScopeVersion:2}},{upsert:true,session});await database.collection('superAdminAudit').insertOne({_id:randomUUID(),action:'WORKFLOW_OFFICE_CHANGED',actorId:actor.uid,departmentId:mapping.departmentId,target:mapping.officeId,backupReference,timestamp:new Date()},{session});});}finally{await session.endSession();}}
 await database.collection('presentationReleaseJournal').updateOne({_id:manifestId},{$set:{state:'complete',completedAt:new Date()}});console.log(JSON.stringify({complete:true,manifestSha256:approved,counts:plan.counts,passwordsChanged:0}));
}catch{console.error('Cleanup stopped safely. Review the operation journal before retrying; credentials are not printed.');process.exitCode=1;}finally{await client.close();await deleteApp(app);}
