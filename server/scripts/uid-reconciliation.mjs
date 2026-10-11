import {isDeepStrictEqual} from 'node:util';

const normalize=v=>String(v||'').trim().toLowerCase();
const identityCollections=new Set(['users','students','clearancePlans','officeStudentSearch','provisioningJobs']);
const uidFields=new Set(['uid','firebaseUid','studentId','studentUid','teacherId','teacherUid','mentorId','mentorUid','hodId','hodUid','officeId','officeUid','approverId','approverUid','actorId','actorUid','recipientId','recipientUid','ownerId','userId','userUid','approverIds','teacherIds','studentIds','mentorIds','recipientIds','caller','actedBy','updatedBy','createdBy','archivedBy','removedBy','reactivatedBy','issuedById','submittedById']);
const documentFields=new Set(['enrollmentId','canonicalEnrollmentId','duplicateOf','marksId']);

export function identityAudit(snapshot,auth){
 const users=snapshot.users||[],duplicates={};
 for(const [collection,field]of [['users','email'],['users','facultyId'],['students','usn']]){
  const groups=new Map();for(const d of snapshot[collection]||[]){const value=normalize(d[field]);if(value){if(!groups.has(value))groups.set(value,[]);groups.get(value).push(d._id);}}
  duplicates[`${collection}.${field}`]=[...groups].filter(([,ids])=>ids.length>1).map(([value,ids])=>({value,ids}));
 }
 const mappings=[],unmatchedAuth=[],ambiguous=[];
 for(const a of auth){
  const found=users.filter(u=>[u.email,u.collegeEmail].some(e=>normalize(e)&&normalize(e)===normalize(a.email)));
  if(found.length>1){ambiguous.push({email:a.email,uids:found.map(u=>u._id)});continue;}
  if(!found.length){unmatchedAuth.push(a);continue;}
  const u=found[0];
  if(a.claims?.role&&a.claims.role!==u.role)throw Error('Auth role conflicts with institutional role.');
  const student=(snapshot.students||[]).find(s=>s._id===u._id);
  for(const [claim,value]of [['usn',student?.usn],['employeeId',u.facultyId],['department',u.department]]){
   if(a.claims?.[claim]&&normalize(a.claims[claim])!==normalize(value))throw Error('Auth institutional claim conflicts with profile.');
  }
  if(mappings.some(m=>m.newUid===a.uid||m.oldUid===u._id))throw Error('Identity mapping is not one-to-one.');
  if(users.some(other=>other._id===a.uid&&other._id!==u._id))throw Error('Production UID already belongs to another profile.');
  mappings.push({oldUid:u._id,newUid:a.uid,email:a.email,role:u.role,disabled:a.disabled,accountStatus:u.accountStatus});
 }
 return {mappings,unmatchedAuth,ambiguous,duplicateFields:duplicates,unmatchedMongo:users.filter(u=>!mappings.some(m=>m.oldUid===u._id)).map(u=>({uid:u._id,email:u.email,role:u.role,facultyId:u.facultyId,accountStatus:u.accountStatus}))};
}

export function migrationPlan(snapshot,audit){
 if(audit.ambiguous.length||Object.values(audit.duplicateFields).some(rows=>rows.length))throw Error('Ambiguous or duplicate identities; no migration allowed.');
 const mapping=new Map(audit.mappings.filter(m=>m.oldUid!==m.newUid).map(m=>[m.oldUid,m.newUid]));
 if([...mapping.values()].some(uid=>mapping.has(uid)))throw Error('Chained UID mappings are unsafe.');
 const remap=v=>mapping.get(v)||v;
 function documentId(collection,id){
  if(identityCollections.has(collection))return remap(id);
  if(['enrollments','marks','notifications'].includes(collection))for(const [oldUid,newUid]of mapping){const separator=collection==='notifications'?'/':'__';if(id.startsWith(oldUid+separator))return newUid+id.slice(oldUid.length);}
  if(collection==='accountExitEvents')for(const [oldUid,newUid]of mapping)for(const action of ['deactivate','reactivate'])if(id.startsWith(`${action}:${oldUid}:`))return `${action}:${newUid}:`+id.slice(action.length+oldUid.length+2);
  return id;
 }
 const enrollmentIds=new Map((snapshot.enrollments||[]).map(d=>[d._id,documentId('enrollments',d._id)]));
 const changes=[],counts={};
 for(const [collection,rows]of Object.entries(snapshot)){
  const ids=new Set();
  for(const before of rows){
   function visit(value,field='',root=false){
    if(typeof value==='string'){
     if(field==='_id'&&root)return documentId(collection,value);
     if(field==='__parent'&&['clearancePlans','notifications'].includes(collection))return remap(value);
     if(uidFields.has(field))return remap(value);
     if(collection==='institutionPolicy'&&before._id==='workflow'&&['library','accounts','physics_lab','chemistry_lab'].includes(field))return remap(value);
     if(documentFields.has(field))return enrollmentIds.get(value)||value;
     return value;
    }
    if(Array.isArray(value))return value.map(v=>visit(v,field));
    // Preserve BSON values, Dates and binary data exactly.
    if(value&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v,k,root&&field==='')]));
    return value;
   }
   const after=visit(before,'',true);
   if(ids.has(after._id))throw Error(`Document ID collision in ${collection}.`);ids.add(after._id);
   if(!isDeepStrictEqual(before,after)){changes.push({collection,before,after});counts[collection]=(counts[collection]||0)+1;}
  }
 }
 return {changes,counts};
}

export async function applyMigration(client,db,snapshot,plan){
 const session=client.startSession();
 try{await session.withTransaction(async()=>{
  const names=(await db.listCollections().toArray()).filter(c=>c.type==='collection').map(c=>c.name).sort();
  if(!isDeepStrictEqual(names,Object.keys(snapshot).sort()))throw Error('Collections changed since backup; audit again.');
  for(const [collection,expected]of Object.entries(snapshot)){
   const actual=await db.collection(collection).find({},{session}).toArray();
   const sort=rows=>rows.slice().sort((a,b)=>String(a._id).localeCompare(String(b._id)));
   if(!isDeepStrictEqual(sort(actual),sort(expected)))throw Error(`Data changed since backup in ${collection}; audit again.`);
  }
  for(const {collection,before,after}of plan.changes){
   const target=db.collection(collection);
   if(before._id===after._id)await target.replaceOne({_id:before._id},after,{session});
   else{await target.deleteOne({_id:before._id},{session});await target.insertOne(after,{session});}
  }
 },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary'});
 }finally{await session.endSession();}
}
