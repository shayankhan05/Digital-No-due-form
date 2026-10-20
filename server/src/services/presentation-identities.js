import {createHash,randomUUID} from 'node:crypto';
import {officeSearchDocument} from './office-search.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
// Operator-only migration primitive. No HTTP route, password change or user
// creation. Invoke only for an explicitly approved, backed-up identity mapping.
export async function normalizeDemoIdentity({database,client,auth,actor,mapping,backupReference}){
 if(actor.role!=='super_admin'||!backupReference||!mapping.uid||!mapping.oldEmail?.endsWith('@demo.test')||!mapping.email?.endsWith('@demo.test')||!['student','hod','office'].includes(mapping.kind))throw Error('Approved demo identity and verified backup required.');
 const {uid,oldEmail,email,name}=mapping,user=await database.collection('users').findOne({_id:uid}),firebase=await auth.getUser(uid);
 if(!user||user.role!==mapping.role||![oldEmail,email].includes(user.email)||![oldEmail,email].includes(firebase.email))throw Error('Identity ownership changed.');
 const operationId='presentation-identity-'+hash(uid+':'+oldEmail+':'+email),completed=await database.collection('presentationIdentityJournal').findOne({_id:operationId,state:'complete'});
 if(completed){if(user.email!==email||firebase.email!==email)throw Error('Completed mapping has drifted.');return {uid,status:'UNCHANGED'};}
 const collision=await database.collection('users').findOne({email,_id:{$ne:uid}}),key='email_'+hash(email),reservation=await database.collection('uniqueIdentities').findOne({_id:key});
 if(collision||reservation&&reservation.uid!==uid)throw Error('Target email is already reserved.');
 try{const owner=await auth.getUserByEmail(email);if(owner.uid!==uid)throw Error('Firebase target email has another owner.');}catch(error){if(error.code!=='auth/user-not-found')throw error;}
 // Journal enables a safe retry if Firebase succeeds but the Mongo transaction
 // fails. Never compensate by overwriting an unrelated or newly changed account.
 await database.collection('presentationIdentityJournal').updateOne({_id:operationId},{$setOnInsert:{uid,oldEmail,email,name,backupReference,state:'prepared',createdAt:new Date()}},{upsert:true});
 if(firebase.email!==email||firebase.displayName!==name)await auth.updateUser(uid,{email,displayName:name});
 const session=client.startSession();try{await session.withTransaction(async()=>{
  const fresh=await database.collection('users').findOne({_id:uid},{session});if(!fresh||![oldEmail,email].includes(fresh.email)||fresh.role!==mapping.role)throw Error('Mongo identity changed. Rerun the approved mapping after review.');
  const clash=await database.collection('uniqueIdentities').findOne({_id:key},{session});if(clash&&clash.uid!==uid)throw Error('Email reservation changed.');
  await database.collection('users').updateOne({_id:uid,email:fresh.email},{$set:{email,name}},{session});
  const student=await database.collection('students').findOne({_id:uid},{session});if(student){if(student.email&&![oldEmail,email].includes(student.email))throw Error('Student email changed.');await database.collection('students').updateOne({_id:uid},{$set:{email,name}},{session});if(await database.collection('officeStudentSearch').findOne({_id:uid},{session}))await database.collection('officeStudentSearch').updateOne({_id:uid},{$set:officeSearchDocument(uid,{...student,email,name})},{session});}
  await database.collection('uniqueIdentities').updateOne({_id:key},{$set:{uid},$setOnInsert:{createdAt:new Date()}},{upsert:true,session});
  const oldKey='email_'+hash(oldEmail);if(oldKey!==key)await database.collection('uniqueIdentities').deleteOne({_id:oldKey,uid},{session});
  // Update only denormalized presentation fields tied to this exact UID.
  // Decision/audit history and all academic keys remain verbatim in their archive.
  for(const collection of ['noDueRequests','approvals','notifications','hallTickets']){
   await database.collection(collection).updateMany({studentId:uid,studentName:mapping.oldName},{$set:{studentName:name}},{session});
   for(const field of ['studentEmail','collegeEmail'])await database.collection(collection).updateMany({studentId:uid,[field]:oldEmail},{$set:{[field]:email}},{session});
  }
  await database.collection('presentationIdentityJournal').updateOne({_id:operationId},{$set:{state:'complete',completedAt:new Date()}},{session});
  await database.collection('superAdminAudit').insertOne({_id:randomUUID(),action:'DEMO_IDENTITY_NORMALIZED',actorId:actor.uid,actorName:actor.name||'Super Admin',target:uid,departmentId:user.departmentId,backupReference,oldName:mapping.oldName,name,oldEmail,email,summary:`Demo identity normalized: ${name}${mapping.usn?' — '+mapping.usn:''}; UID preserved`,timestamp:new Date()},{session});
 });}finally{await session.endSession();}
 return {uid,status:'UPDATED',passwordChanged:false};
}
