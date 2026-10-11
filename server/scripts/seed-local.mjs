import {migrateDemoDepartment} from '../src/services/department-migration.js';
// Additive restoration of saved emulator identities, never production or resets.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {connectDatabase} from '../src/db.js';
import {DocumentStore} from '../src/services/document-store.js';
import {firebaseAdmin} from '../src/firebase-admin.js';
import {syncOfficeSearchIndex} from '../src/services/office-search.js';
import {repairDemoPasswordFlags,readEmulatorAuthMetadata} from '../src/services/demo-password-policy.js';
const root=new URL('../',import.meta.url),host=process.env.FIREBASE_AUTH_EMULATOR_HOST||'127.0.0.1:9199',project=process.env.FIREBASE_PROJECT_ID||'demo-digital-no-due',uri=process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/digital_no_due_dev?replicaSet=rs0';
if(project!=='demo-digital-no-due'||host!=='127.0.0.1:9199'||new URL(uri).hostname!=='127.0.0.1'||new URL(uri).pathname!=='/digital_no_due_dev')throw new Error('Local seed refuses non-demo Auth or a non-local/non-dev database.');
process.env.FIREBASE_PROJECT_ID=project;process.env.FIREBASE_AUTH_EMULATOR_HOST=host;
const {client,database}=await connectDatabase(uri),store=new DocumentStore(database,client),{auth,app}=firebaseAdmin();
try{
 let inserted=0;if(!await database.collection('users').countDocuments()){const rows=JSON.parse(await readFile(new URL('migration-output/firestore-export.json',root),'utf8'),(k,v)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)?new Date(v):v);for(const row of rows){if(!(await store.doc(row.path).get()).exists){await store.doc(row.path).set(row.data);inserted++;}}}
 console.log('Department normalization:',JSON.stringify(await migrateDemoDepartment(database,client,{apply:true})));
 const saved=JSON.parse(await readFile(new URL('auth-emulator-backup/auth_export/accounts.json',root),'utf8')),existing=[];let cursor;do{const page=await auth.listUsers(1000,cursor);existing.push(...page.users);cursor=page.pageToken;}while(cursor);
 const ids=new Set(existing.map(u=>u.uid)),emails=new Map(existing.map(u=>[u.email?.toLowerCase(),u.uid]));const missing=[];
 for(const user of saved.users){if(ids.has(user.localId))continue;if(emails.has(user.email?.toLowerCase()))throw new Error('Saved email belongs to a different current Auth UID; no account will be overwritten.');const p=await database.collection('users').findOne({_id:user.localId});if(p&&p.email?.toLowerCase()!==user.email?.toLowerCase())throw new Error('Saved Auth UID conflicts with its institutional profile.');missing.push(user);}
 if(missing.length){const response=await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchCreate`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},body:JSON.stringify({users:missing,allowOverwrite:false})}),result=await response.json();if(!response.ok||result.error?.length)throw new Error('Emulator identity restoration failed. Existing identities were not reset.');}
 const passwordPolicy=await repairDemoPasswordFlags(database,await readEmulatorAuthMetadata(project,host),new Set(saved.users.map(u=>u.localId)));
 console.log('Password policy:',JSON.stringify(Object.fromEntries(Object.entries(passwordPolicy).map(([k,v])=>[k,v.length]))));
 for(const s of await database.collection('students').find({}).toArray())await syncOfficeSearchIndex(store,s._id);
 const summary={restoredAuth:missing.length,unchangedAuth:existing.length,insertedApplicationRecords:inserted,users:await database.collection('users').countDocuments(),students:await database.collection('students').countDocuments(),enrollments:await database.collection('enrollments').countDocuments(),marks:await database.collection('marks').countDocuments(),requests:await database.collection('noDueRequests').countDocuments()};console.log(JSON.stringify(summary,null,2));
}finally{await client.close();await app.delete();}
