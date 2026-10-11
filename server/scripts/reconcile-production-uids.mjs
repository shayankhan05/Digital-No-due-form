// Deliberately separate from local seed/migration tools. Credentials stay in files.
import fs from 'node:fs/promises';
import path from 'node:path';
import {MongoClient, BSON} from 'mongodb';
import {initializeApp, cert, deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import dns from 'node:dns';
import {createHash} from 'node:crypto';
import {identityAudit,migrationPlan,applyMigration} from './uid-reconciliation.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i<0?[v,true]:[v.slice(0,i),v.slice(i+1)];}));
if(args['--apply']!==undefined&&args['--apply']!==true)throw Error('Use the explicit --apply flag without a value.');
if(args['--dns-server'])dns.setServers([args['--dns-server']]);
if(!args['--uri-file']||!args['--key-file'])throw Error('Provide --uri-file and --key-file; never pass secrets on the command line.');
if(process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('Emulator environment refused.');
const raw=(await fs.readFile(args['--uri-file'],'utf8')).trim();
const uri=(raw.match(/^\s*MONGODB_URI\s*=\s*(.+)\s*$/m)?.[1]||raw).trim().replace(/^(['"])(.*)\1$/,'$2');
if(!uri.startsWith('mongodb+srv://'))throw Error('Expected Atlas SRV URI.');
const key=JSON.parse(await fs.readFile(args['--key-file'],'utf8'));
if(key.project_id!=='digital-no-due-shayan')throw Error('Unexpected Firebase project.');
const client=new MongoClient(uri,{serverSelectionTimeoutMS:20000,promoteValues:false});
const app=initializeApp({credential:cert(key),projectId:key.project_id},'uid-reconciliation');
try{
 await client.connect();const db=client.db();
 if(db.databaseName!=='digital_no_due')throw Error('Expected digital_no_due production database.');
 const output=path.resolve('migration-output',`production-uids-${new Date().toISOString().replace(/[:.]/g,'-')}`);
 await fs.mkdir(output,{recursive:true});
 const snapshot={};const metadata=[];
 for(const info of await db.listCollections().toArray()){
  if(info.type!=='collection')continue;
  const rawRows=await db.collection(info.name).find({},{raw:true}).toArray();
  snapshot[info.name]=rawRows.map(row=>BSON.deserialize(row,{promoteValues:false}));
  metadata.push({name:info.name,options:info.options,indexes:await db.collection(info.name).indexes()});
  await fs.writeFile(path.join(output,`${info.name}.bson`),Buffer.concat(rawRows));
  await fs.writeFile(path.join(output,`${info.name}.ejson`),BSON.EJSON.stringify(snapshot[info.name],{relaxed:false}));
 }
 await fs.writeFile(path.join(output,'collection-metadata.ejson'),BSON.EJSON.stringify(metadata,{relaxed:false}));
 const auth=[];let page;do{const result=await getAuth(app).listUsers(1000,page);auth.push(...result.users.map(u=>({uid:u.uid,email:u.email,disabled:u.disabled,claims:u.customClaims||{}})));page=result.pageToken;}while(page);
 await fs.writeFile(path.join(output,'auth-identities.json'),JSON.stringify(auth,null,2));
 const report={backup:output,counts:Object.fromEntries(Object.entries(snapshot).map(([k,v])=>[k,v.length])),authCount:auth.length,...identityAudit(snapshot,auth)};
 await fs.writeFile(path.join(output,'audit.json'),JSON.stringify(report,null,2));
 const manifest={};for(const file of await fs.readdir(output))manifest[file]=createHash('sha256').update(await fs.readFile(path.join(output,file))).digest('hex');
 await fs.writeFile(path.join(output,'sha256.json'),JSON.stringify(manifest,null,2));
 const plan=migrationPlan(snapshot,report);
 await fs.writeFile(path.join(output,'plan.ejson'),BSON.EJSON.stringify(plan,{relaxed:false}));
 console.log(JSON.stringify({...report,unmatchedMongo:report.unmatchedMongo.length,updates:plan.counts},null,2));
 if(args['--apply']){
  if(args['--expect-mappings']!==String(report.mappings.filter(m=>m.oldUid!==m.newUid).length))throw Error('Specify --expect-mappings to acknowledge the audited mapping count.');
  await applyMigration(client,db,snapshot,plan);
  // Compare every document against the expected transformation, not just counts.
  const {isDeepStrictEqual}=await import('node:util');
  for(const [name,rows]of Object.entries(snapshot)){
   const changes=new Map(plan.changes.filter(c=>c.collection===name).map(c=>[c.before._id,c.after]));
   const target=rows.map(d=>changes.get(d._id)||d).sort((a,b)=>String(a._id).localeCompare(String(b._id)));
   const actual=(await db.collection(name).find({}).toArray()).sort((a,b)=>String(a._id).localeCompare(String(b._id)));
   if(!isDeepStrictEqual(target,actual))throw Error(`Post-migration verification failed in ${name}.`);
  }
  const result={applied:true,mappings:report.mappings,updates:plan.counts,allDocumentsVerified:true,authModified:false,backup:output};
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }
}catch(error){console.error(`Production audit failed (${error.code||error.name}); details suppressed to protect credentials.`);process.exitCode=1;}
finally{await client.close();await deleteApp(app);}
