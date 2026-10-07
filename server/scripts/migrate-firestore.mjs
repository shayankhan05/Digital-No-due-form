// Read-only loopback Firestore export; additive, idempotent Mongo import.
import {initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {mkdir,writeFile} from 'node:fs/promises';
import {connectDatabase} from '../src/db.js';
import {DocumentStore,location} from '../src/services/document-store.js';
import {syncOfficeSearchIndex} from '../src/services/office-search.js';
import {isDeepStrictEqual} from 'node:util';
const project=process.env.SOURCE_PROJECT_ID||'demo-digital-no-due',host=process.env.SOURCE_FIRESTORE_HOST||'127.0.0.1:8180';
if(!project.startsWith('demo-')||!/^127\.0\.0\.1:\d+$/.test(host))throw new Error('This migration tool exports only demo loopback emulators.');
const uri=process.env.MONGODB_URI;if(!uri||!['digital_no_due_dev','digital_no_due_migration'].includes(new URL(uri).pathname.slice(1)))throw new Error('Target must be a separate digital_no_due_dev or digital_no_due_migration database.');
const authHost=process.env.SOURCE_AUTH_HOST||'127.0.0.1:9199';if(!/^127\.0\.0\.1:\d+$/.test(authHost))throw new Error('Source Auth must also be a loopback emulator.');
process.env.FIRESTORE_EMULATOR_HOST=host;process.env.FIREBASE_AUTH_EMULATOR_HOST=authHost;
const app=initializeApp({projectId:project},'export'),source=getFirestore(app),{client,database}=await connectDatabase(uri),store=new DocumentStore(database,client);
const convert=v=>v?.toDate?v.toDate():Array.isArray(v)?v.map(convert):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['password','passwordHash','passwordSalt','privateKey'].includes(k)).map(([k,x])=>[k,convert(x)])):v;
try{
 const records=[],counts={};async function visit(collection){for(const doc of (await collection.get()).docs){records.push({path:doc.ref.path,data:convert(doc.data())});for(const child of await doc.ref.listCollections())await visit(child);}}
 for(const collection of await source.listCollections())if(collection.id!=='officeStudentSearch')await visit(collection);
 await mkdir('migration-output',{recursive:true});await writeFile('migration-output/firestore-export.json',JSON.stringify(records,null,2));
 let inserted=0,unchanged=0;for(const row of records){const loc=location(row.path),existing=await database.collection(loc.collection).findOne({_id:loc.id});counts[loc.collection]=(counts[loc.collection]||0)+1;if(existing){const expected={...row.data,...(loc.collection==='users'?{firebaseUid:loc.id}:{})};const {_id,__parent,...actual}=existing;if(!isDeepStrictEqual(actual,expected))throw new Error(`Existing target differs: ${row.path}. Migration will never overwrite it.`);unchanged++;}else{await store.doc(row.path).set(row.data);inserted++;}}
 const authUsers=new Set();let token;do{const page=await getAuth(app).listUsers(1000,token);page.users.forEach(u=>authUsers.add(u.uid));token=page.pageToken;}while(token);
 const issues=[];for(const row of records){if(row.path.startsWith('enrollments/')){for(const [field,collection]of [['studentId','students'],['offeringId','offerings']])if(!await database.collection(collection).findOne({_id:row.data[field]}))issues.push({path:row.path,missing:field});}if(/^users\/[^/]+$/.test(row.path)&&!authUsers.has(row.path.split('/')[1]))issues.push({path:row.path,missing:'Auth identity (pre-existing fixture)'});}
 for(const student of await database.collection('students').find({}).toArray())await syncOfficeSearchIndex(store,student._id);
 for(const request of await database.collection('noDueRequests').find({status:'issued'}).toArray())if(!await database.collection('hallTickets').findOne({_id:request._id}))await store.doc(`hallTickets/${request._id}`).set({requestId:request._id,studentId:request.studentId,usn:request.usn||'',issuedById:request.issuedById||'',issuedBy:request.issuedBy||'',issuedAt:request.issuedAt||request.updatedAt||request.createdAt,source:'migrated-issued-request'});
 const verified={};for(const [collection,count]of Object.entries(counts)){verified[collection]=await database.collection(collection).countDocuments();if(verified[collection]<count)throw new Error('Migration count mismatch.');}
 const result={source:project,targetDatabase:database.databaseName,sourceAuthUsers:authUsers.size,inserted,unchanged,sourceCounts:counts,targetCounts:verified,relationshipIssues:issues,authUsersModified:0,sourceDocumentsModified:0};await writeFile('migration-output/migration-report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await client.close();await app.delete();}
