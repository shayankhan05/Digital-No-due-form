// Read-only by default. --apply adds absent identity reservations only;
// it never updates users, profiles, authentication, marks or workflow history.
import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns';
import {createHash} from 'node:crypto';
import {MongoClient,BSON} from 'mongodb';
import {initializeApp,cert,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {integritySnapshot,auditIntegrity,identityReservationPlan} from '../src/services/integrity-audit.js';
const args=process.argv.slice(2),arg=key=>args[args.indexOf(key)+1],apply=args.includes('--apply');
if(!args.includes('--uri-file')||!args.includes('--credential-file')||!args.includes('--output-dir')||process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('Provide --uri-file, --credential-file and --output-dir; emulator environment is not permitted.');
const credentials=JSON.parse(await fs.readFile(arg('--credential-file'),'utf8'));
if(credentials.project_id!=='digital-no-due-shayan')throw Error('Unexpected Firebase project; no changes made.');
const raw=await fs.readFile(arg('--uri-file'),'utf8'),uri=raw.match(/(?:^|\n)\s*MONGODB_URI\s*=\s*["']?([^\r\n"']+)/)?.[1]?.trim();
if(!uri?.startsWith('mongodb+srv://'))throw Error('Expected named Atlas URI; no changes made.');
dns.setServers(['1.1.1.1']);
const client=new MongoClient(uri),firebase=initializeApp({credential:cert(credentials)},'institutional-audit'),auth=getAuth(firebase);
const digest=rows=>createHash('sha256').update(BSON.EJSON.stringify(rows)).digest('hex');
try{
 await client.connect();const database=client.db('digital_no_due'),snapshot=await integritySnapshot(database),before=auditIntegrity(snapshot),plan=identityReservationPlan(snapshot),authConflicts=[];
 for(let i=0;i<snapshot.users.length;i+=100){const users=snapshot.users.slice(i,i+100),result=await auth.getUsers(users.map(u=>({uid:u._id}))),byId=new Map(result.users.map(u=>[u.uid,u]));for(const u of users){const identity=byId.get(u._id);if(!identity||identity.email?.toLowerCase()!==u.email?.toLowerCase())authConflicts.push({uid:u._id,reason:identity?'UID email mismatch':'Missing Auth UID'});}}
 const documented=new Set(before.explainedLegacy.filter(r=>r.type==='LEGACY_USER_ONLY').map(r=>r.id));
 const unexplainedAuth=authConflicts.filter(r=>!documented.has(r.uid));
 const report={mode:apply?'apply':'dry-run',before,additions:plan.additions.length,identityConflicts:plan.conflicts,authConflicts:unexplainedAuth,explainedLegacyAuth:authConflicts.filter(r=>documented.has(r.uid))};
 const output=path.resolve(arg('--output-dir'));await fs.mkdir(output,{recursive:true});
 if(apply){
  if(plan.conflicts.length||unexplainedAuth.length)throw Error('Identity/Auth conflicts prevent application. Run dry-run and inspect report.');
  const names=(await database.listCollections().toArray()).map(c=>c.name).filter(n=>!n.startsWith('system.')),full=Object.fromEntries(await Promise.all(names.map(async n=>[n,await database.collection(n).find({}).sort({_id:1}).toArray()]))),indexes=Object.fromEntries(await Promise.all(names.map(async n=>[n,await database.collection(n).indexes()])));
  const backup=path.join(output,'professor-identity-before-'+Date.now()+'.ejson');await fs.writeFile(backup,BSON.EJSON.stringify({createdAt:new Date(),database:'digital_no_due',snapshot:full,indexes}),{flag:'wx'});
  const reread=BSON.EJSON.parse(await fs.readFile(backup,'utf8'));if(digest(reread.snapshot)!==digest(full))throw Error('Backup verification failed.');
  const session=client.startSession();try{await session.withTransaction(async()=>{const current={users:await database.collection('users').find({},{session}).toArray(),students:await database.collection('students').find({},{session}).toArray(),uniqueIdentities:await database.collection('uniqueIdentities').find({},{session}).toArray()},fresh=identityReservationPlan(current);if(fresh.conflicts.length||digest(current.users)!==digest(snapshot.users)||digest(current.students)!==digest(snapshot.students))throw Error('Institutional records changed during review; rerun dry-run.');for(const row of fresh.additions)await database.collection('uniqueIdentities').updateOne({_id:row._id},{$setOnInsert:row},{upsert:true,session});});}finally{await session.endSession();}
  report.backup=backup;report.after=auditIntegrity(await integritySnapshot(database));report.preservedCollections=[];
  for(const name of names.filter(n=>n!=='uniqueIdentities')){const after=await database.collection(name).find({}).sort({_id:1}).toArray();if(digest(full[name])!==digest(after))throw Error('Concurrent change detected in '+name+'; inspect backup. No destructive repair attempted.');report.preservedCollections.push(name);}
  report.rerunAdditions=identityReservationPlan(await integritySnapshot(database)).additions.length;
 }
 await fs.writeFile(path.join(output,'professor-identity-'+(apply?'apply':'plan')+'.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({mode:report.mode,users:snapshot.users.length,additions:report.additions,identityConflicts:plan.conflicts.length,authConflicts:unexplainedAuth.length,explainedLegacyAuth:report.explainedLegacyAuth.length,beforeUnexplained:before.unexplained,explainedLegacy:before.explainedLegacy.length,afterUnexplained:report.after?.unexplained,rerunAdditions:report.rerunAdditions,preservedCollections:report.preservedCollections?.length}));
}catch(error){console.error(error.message.includes('mongodb')?'Atlas operation failed; inspect local diagnostics without exposing credentials.':error.message);process.exitCode=1;}finally{await client.close();await deleteApp(firebase);}
