const fail=message=>{throw Object.assign(new Error(message),{code:'invalid-argument'});};
import {randomUUID} from 'node:crypto';
// Preserve legacy section assignments; status only controls new selections.
export function sectionMaster(policy={}) {
 const records=new Map((policy.sectionRecords||[]).map(s=>[s.code,s]));
 for(const code of policy.sections||['A','B','C'])if(!records.has(code))records.set(code,{_id:'section_'+code,code,name:code,status:'active'});
 return [...records.values()].sort((a,b)=>a.code.localeCompare(b.code));
}
// An empty department list means the shared catalog shown by Academic Setup.
// Explicit department restrictions and catalog ownership still bound admission.
export function studentSectionCodes(policy={},department){
 const code=value=>String(value??'').trim().toUpperCase(),id=department?.id||department?._id;
 const configured=department?.sections?.length?new Set(department.sections.map(code)):null;
 return [...new Set(sectionMaster(policy).filter(s=>s.status==='active'&&(!s.departmentId||s.departmentId===id)&&(!s.departmentIds?.length||s.departmentIds.includes(id))).map(s=>code(s.code)).filter(s=>s&&(!configured||configured.has(s))))];
}
export async function saveSection(database,client,actor,input){
 const code=String(input.code||'').trim().toUpperCase();
 if(!/^[A-Z0-9-]{1,10}$/.test(code)||!['active','inactive'].includes(input.status))fail('Choose a valid section code and status.');
 const session=client.startSession();let saved;
 try{await session.withTransaction(async()=>{
  const policy=await database.collection('institutionPolicy').findOne({_id:'institution'},{session})||{},rows=sectionMaster(policy),old=rows.find(s=>s._id===input.id);
  if(input.id&&!old)fail('Section not found.');
  if(old&&old.code!==code)fail('Section codes cannot change.');
  if(!old&&rows.some(s=>s.code===code))fail('Section already exists.');
  if(old?.status===input.status){saved=old;return;}
  saved={_id:'section_'+code,code,name:code,status:input.status};
  const next=[...rows.filter(s=>s.code!==code),saved],active=next.filter(s=>s.status==='active').map(s=>s.code);
  if(!active.length)fail('Keep at least one active section.');
  await database.collection('institutionPolicy').updateOne({_id:'institution'},{$set:{sections:active,sectionRecords:next}},{upsert:true,session});
  if(!old&&actor.managementDepartmentId&&!input.catalogOnly)await database.collection('departments').updateOne({_id:actor.managementDepartmentId},{$addToSet:{sections:code},$set:{updatedAt:new Date()}},{session});
  await database.collection('superAdminAudit').insertOne({_id:randomUUID(),actorId:actor.uid,actorUid:actor.uid,actorRole:actor.role,action:!old?'SECTION_CREATED':input.status==='active'?'SECTION_ACTIVATED':'SECTION_DEACTIVATED',targets:[saved._id],timestamp:new Date(),summary:'Section '+code+' '+input.status+'. Existing assignments preserved.'},{session});
 });}finally{await session.endSession();}return saved;
}
