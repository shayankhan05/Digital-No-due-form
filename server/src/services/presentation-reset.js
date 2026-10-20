import {createHash,randomUUID} from 'node:crypto';
import {EJSON} from 'bson';
export const recordDigest=value=>createHash('sha256').update(EJSON.stringify(value,{relaxed:false})).digest('hex');
// Operator-only service: deliberately not mounted as an HTTP route or normal UI.
// A reviewed manifest, verified external archive reference and unchanged records
// are required. The caller must obtain explicit approval before invoking it.
export async function archiveDemoWorkflow({database,client,actor,manifest,backupReference}){
 if(actor.role!=='super_admin'||!backupReference||!Array.isArray(manifest))throw Error('Reviewed manifest and verified backup required.');
 const results=[];
 for(const selected of manifest){
  const session=client.startSession();try{await session.withTransaction(async()=>{
   const archiveId='presentation-reset-'+selected.requestId;
   if(await database.collection('presentationWorkflowArchives').findOne({_id:archiveId},{session})){results.push({requestId:selected.requestId,status:'ALREADY_ARCHIVED'});return;}
   const user=await database.collection('users').findOne({_id:selected.studentId},{session}),student=await database.collection('students').findOne({_id:selected.studentId},{session}),request=await database.collection('noDueRequests').findOne({_id:selected.requestId},{session});
   if(user?.role!=='student'||!user.email?.toLowerCase().endsWith('@demo.test')||!student||request?.studentId!==user._id||recordDigest(request)!==selected.requestDigest)throw Error('Demo request changed or identity is not eligible. Generate a fresh dry-run.');
   const records={noDueRequests:[request]};
   for(const [collection,ids]of Object.entries(selected.relatedIds||{})){
    if(!['approvals','notifications','hallTickets','workflowOverrides'].includes(collection)||!Array.isArray(ids))throw Error('Unexpected reset collection.');
    const rows=await database.collection(collection).find({_id:{$in:ids}},{session}).sort({_id:1}).toArray();
    if(rows.length!==ids.length||recordDigest(rows)!==selected.relatedDigests[collection]||rows.some(r=>r.requestId!==request._id&&r.__parent!==request._id&&!String(r._id).startsWith(request._id+'/')&&!(collection==='hallTickets'&&r._id===request._id)))throw Error('Associated workflow records changed.');records[collection]=rows;
   }
   const at=new Date();await database.collection('presentationWorkflowArchives').insertOne({_id:archiveId,studentId:user._id,requestId:request._id,actorId:actor.uid,at,backupReference,records,digest:recordDigest(records)},{session});
   for(const [collection,rows]of Object.entries(records))await database.collection(collection).deleteMany({_id:{$in:rows.map(r=>r._id)}},{session});
   await database.collection('superAdminAudit').insertOne({_id:randomUUID(),action:'DEMO_WORKFLOW_RESET',actorId:actor.uid,actorName:actor.name||'Super Admin',studentId:user._id,target:user._id,requestId:request._id,departmentId:student.departmentId,backupReference,archiveId,summary:`Archived presentation test workflow for ${student.name} — ${student.usn}`,timestamp:at},{session});results.push({requestId:request._id,status:'ARCHIVED'});
  });}finally{await session.endSession();}
 }
 return results;
}
