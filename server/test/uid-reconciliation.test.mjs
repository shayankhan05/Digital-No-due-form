import {test} from 'node:test';
import assert from 'node:assert/strict';
import {identityAudit,migrationPlan,applyMigration} from '../scripts/uid-reconciliation.mjs';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {MongoClient} from 'mongodb';
import {initializeModels} from '../src/models/index.js';
import {DocumentStore} from '../src/services/document-store.js';
import {canRead} from '../src/services/authorization.js';
import {loginIdentity} from '../src/services/authentication.js';
import {createApp} from '../src/app.js';
import {firebaseAdmin} from '../src/firebase-admin.js';
import request from 'supertest';

function fixture(){return {
 users:[{_id:'old-student',firebaseUid:'old-student',email:'student@audit.test',role:'student',name:'Student'},
 {_id:'old-teacher',firebaseUid:'old-teacher',email:'teacher@audit.test',role:'subject_faculty',facultyId:'EMP1'},
 {_id:'library',firebaseUid:'library',email:'library@audit.test',role:'library',name:'library',facultyId:'library'}],
 students:[{_id:'old-student',uid:'old-student',usn:'USN100',email:'student@audit.test',department:'ISE',scheme:'2022',semester:5,section:'C',teacherIds:['old-teacher']}],
 offerings:[{_id:'class-C',teacherId:'old-teacher',department:'ISE',scheme:'2022',semester:5,section:'C'}],
 enrollments:[{_id:'old-student__class-C',studentId:'old-student',teacherId:'old-teacher',offeringId:'class-C',active:true}],
 marks:[{_id:'old-student__class-C',studentId:'old-student',teacherId:'old-teacher',offeringId:'class-C',scores:{ia1:27,assignment:9},updatedAt:new Date('2026-01-01'),updatedBy:'old-teacher'}],
 noDueRequests:[{_id:'request1',studentId:'old-student',status:'issued',approverIds:['old-teacher','library'],approvalItems:{subject_class:{studentUid:'old-student',teacherUid:'old-teacher',approverId:'old-teacher',enrollmentId:'old-student__class-C'},library:{approverType:'library',label:'library',approverId:'library'}},workflowHistory:[{approvals:{library:{approverId:'library',status:'rejected',reason:'Return book'}}}]}],
 approvals:[{_id:'request1/library',__parent:'request1',approverId:'library',actedBy:'library',status:'approved',reason:'Return book',history:[{actorId:'library',studentUid:'old-student'}]}],
 notifications:[{_id:'old-student/n1',__parent:'old-student',studentId:'old-student',actorId:'library',actorType:'library',approvalId:'library',message:'library'}],
 clearancePlans:[{_id:'old-student',__parent:'old-student',approverIds:['library','old-teacher']}],
 hallTickets:[{_id:'request1',requestId:'request1',studentId:'old-student',issuedAt:new Date('2026-01-02')}],
 officeStudentSearch:[{_id:'old-student',uid:'old-student',email:'student@audit.test'}],
 provisioningJobs:[{_id:'old-student',caller:'old-teacher',digest:'unchanged',result:{uid:'old-student'}}],
 uniqueIdentities:[{_id:'email_hash',uid:'old-student'}],
 institutionPolicy:[{_id:'workflow',library:'library'}],
 accountExitEvents:[{_id:'deactivate:old-student:123',uid:'old-student',actorId:'old-teacher',identity:{email:'student@audit.test'}}]
};}
const identities=()=>[{uid:'new-student',email:'STUDENT@audit.test',disabled:false},{uid:'new-teacher',email:'teacher@audit.test',disabled:false},{uid:'new-library',email:'library@audit.test',disabled:false}];
const transformed=(snapshot,plan)=>Object.fromEntries(Object.entries(snapshot).map(([name,rows])=>[name,rows.map(d=>plan.changes.find(c=>c.collection===name&&c.before._id===d._id)?.after||d)]));

test('exact normalized email maps all roles; aliases are never inferred from role',()=>{const s=fixture(),a=identityAudit(s,[...identities(),{uid:'other',email:'mentor@test.com'}]);assert.equal(a.mappings.length,3);assert.equal(a.unmatchedAuth.length,1);assert.equal(identityAudit(s,[{uid:'x',email:'student@test.com'}]).mappings.length,0);});
test('ambiguous emails abort before writes',()=>{const s=fixture();s.users.push({...s.users[0],_id:'other'});assert.throws(()=>migrationPlan(s,identityAudit(s,identities())),/Ambiguous/);});
test('duplicate USNs and employee IDs abort even outside the mapped subset',()=>{for(const type of ['usn','facultyId']){const s=fixture();if(type==='usn')s.students.push({...s.students[0],_id:'other'});else s.users.push({_id:'other',email:'other@audit.test',facultyId:'emp1'});assert.throws(()=>migrationPlan(s,identityAudit(s,identities())),/duplicate/);}});
test('occupied production UID and conflicting Auth claims are rejected',()=>{const s=fixture();s.users.push({_id:'new-student',email:'other@audit.test'});assert.throws(()=>identityAudit(s,identities()),/belongs/);assert.throws(()=>identityAudit(fixture(),[{...identities()[0],claims:{usn:'WRONG'}}]),/conflicts/);});
test('document ID collisions abort without overwriting existing marks',()=>{const s=fixture();s.marks.push({_id:'new-student__class-C',scores:{ia1:11}});assert.throws(()=>migrationPlan(s,identityAudit(s,identities())),/collision/);});
test('all nested references, notification paths, reservation IDs and enrollment IDs migrate',()=>{const s=fixture(),p=migrationPlan(s,identityAudit(s,identities())),after=transformed(s,p);assert.equal(after.marks[0]._id,'new-student__class-C');assert.equal(after.noDueRequests[0].approvalItems.subject_class.enrollmentId,'new-student__class-C');assert.equal(after.noDueRequests[0].workflowHistory[0].approvals.library.approverId,'new-library');assert.equal(after.notifications[0]._id,'new-student/n1');assert.equal(after.notifications[0].__parent,'new-student');assert.equal(after.uniqueIdentities[0].uid,'new-student');assert.equal(after.accountExitEvents[0]._id,'deactivate:new-student:123');});
test('role labels, names, employee IDs, approval keys, marks and history are preserved',()=>{const s=fixture(),after=transformed(s,migrationPlan(s,identityAudit(s,identities())));assert.deepEqual(after.marks[0].scores,s.marks[0].scores);assert.deepEqual(after.marks[0].updatedAt,s.marks[0].updatedAt);assert.equal(after.users[2].name,'library');assert.equal(after.users[2].facultyId,'library');assert.equal(after.users[2].role,'library');assert.equal(after.notifications[0].approvalId,'library');assert.equal(after.noDueRequests[0].status,'issued');assert.equal(after.noDueRequests[0].workflowHistory[0].approvals.library.reason,'Return book');assert.deepEqual(after.hallTickets[0].issuedAt,s.hallTickets[0].issuedAt);});
test('inactive state and dismissal/password policy fields remain unchanged',()=>{const s=fixture();Object.assign(s.users[0],{accountStatus:'inactive',active:false,mustChangePassword:true,removedBy:'old-teacher'});const after=transformed(s,migrationPlan(s,identityAudit(s,identities())));assert.equal(after.users[0].accountStatus,'inactive');assert.equal(after.users[0].active,false);assert.equal(after.users[0].mustChangePassword,true);assert.equal(after.users[0].removedBy,'new-teacher');});
test('repeated reconciliation is a no-op',()=>{const s=fixture(),after=transformed(s,migrationPlan(s,identityAudit(s,identities())));assert.equal(migrationPlan(after,identityAudit(after,identities())).changes.length,0);});
test('atomic migration supports login identifiers and ownership while preserving every document',async()=>{
 const mongo=await MongoMemoryReplSet.create({replSet:{storageEngine:'wiredTiger'}}),client=new MongoClient(mongo.getUri());
 try{await client.connect();const db=client.db('uid_audit');await initializeModels(db);const s=fixture();for(const [name,rows]of Object.entries(s))await db.collection(name).insertMany(rows);const snapshot={};for(const c of await db.listCollections().toArray())snapshot[c.name]=await db.collection(c.name).find({}).toArray();
 const p=migrationPlan(snapshot,identityAudit(snapshot,identities()));await applyMigration(client,db,snapshot,p);const expected=transformed(snapshot,p);for(const[name,rows]of Object.entries(expected)){assert.equal(await db.collection(name).countDocuments(),rows.length);for(const row of rows)assert.deepEqual(await db.collection(name).findOne({_id:row._id}),row);}
 assert.equal((await loginIdentity(db,'student@audit.test'))._id,'new-student');assert.equal((await loginIdentity(db,'usn100'))._id,'new-student');assert.equal((await loginIdentity(db,'EMP1'))._id,'new-teacher');
 const store=new DocumentStore(db,client),marks=await db.collection('marks').findOne({});assert.equal(await canRead(store,{uid:'new-teacher',role:'subject_faculty'},'marks/'+marks._id,marks),true);assert.equal(await canRead(store,{uid:'other-teacher',role:'subject_faculty'},'marks/'+marks._id,marks),false);assert.equal(await canRead(store,{uid:'new-student',role:'student'},'marks/'+marks._id,marks),true);
 const r=await db.collection('noDueRequests').findOne({});assert.equal(await canRead(store,{uid:'new-library',role:'library'},'noDueRequests/request1',r),true);assert.equal(await canRead(store,{uid:'library',role:'library'},'noDueRequests/request1',r),false);
 await db.collection('users').updateOne({_id:'new-student'},{$set:{accountStatus:'inactive'}});await assert.rejects(()=>loginIdentity(db,'USN100'));await assert.rejects(()=>applyMigration(client,db,snapshot,p),/changed/);
 }finally{await client.close();await mongo.stop();}
});
test('real isolated Auth password login rejects old UID and accepts the reconciled UID',async()=>{
 assert.equal(process.env.FIREBASE_PROJECT_ID,'demo-mongo-audit');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9298');
 const mongo=await MongoMemoryReplSet.create({replSet:{storageEngine:'wiredTiger'}}),client=new MongoClient(mongo.getUri()),firebase=firebaseAdmin();let user;
 try{await client.connect();const db=client.db('uid_login_audit');await initializeModels(db);user=await firebase.auth.createUser({email:'uid-login@audit.test',password:'UidAuditPassword123!'});await db.collection('users').insertOne({_id:'emulator-old',firebaseUid:'emulator-old',email:user.email,role:'student'});await db.collection('students').insertOne({_id:'emulator-old',uid:'emulator-old',usn:'UID100'});const {app}=createApp({database:db,client,auth:firebase.auth,demo:true});
 assert.equal((await request(app).post('/api/auth/login').send({identifier:user.email,password:'UidAuditPassword123!'})).status,401);
 const s={};for(const c of await db.listCollections().toArray())s[c.name]=await db.collection(c.name).find({}).toArray();await applyMigration(client,db,s,migrationPlan(s,identityAudit(s,[{uid:user.uid,email:user.email}])));
 for(const identifier of [user.email,'UID100'])assert.equal((await request(app).post('/api/auth/login').send({identifier,password:'UidAuditPassword123!'})).status,200);
 assert.equal((await request(app).post('/api/auth/login').send({identifier:user.email,password:'WrongPassword123!'})).status,401);
 }finally{if(user)await firebase.auth.deleteUser(user.uid);await firebase.app.delete();await client.close();await mongo.stop();}
});
