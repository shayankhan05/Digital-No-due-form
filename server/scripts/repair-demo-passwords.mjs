import {MongoClient} from 'mongodb';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {repairDemoPasswordFlags,readEmulatorAuthMetadata} from '../src/services/demo-password-policy.js';
const project='demo-digital-no-due',host='127.0.0.1:9199';
if(process.env.FIREBASE_PROJECT_ID&&process.env.FIREBASE_PROJECT_ID!==project||process.env.FIREBASE_AUTH_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST!==host)throw new Error('Refusing non-local demo configuration.');
const client=await new MongoClient('mongodb://127.0.0.1:27017/digital_no_due_dev?replicaSet=rs0').connect();
try {
 const db=client.db(),saved=JSON.parse(await readFile(new URL('../auth-emulator-backup/auth_export/accounts.json',import.meta.url)));
 const output=new URL('../test/browser-artifacts/password-policy-'+Date.now()+'/',import.meta.url);await mkdir(output,{recursive:true});
 await writeFile(new URL('password-policy-before.json',output),JSON.stringify(await db.collection('users').find({}).toArray()));
 const result=await repairDemoPasswordFlags(db,await readEmulatorAuthMetadata(project,host),new Set(saved.users.map(u=>u.localId)));
 await writeFile(new URL('password-policy-repair.json',output),JSON.stringify(result,null,2));
 console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,v.length])),null,2));
} finally {await client.close();}
