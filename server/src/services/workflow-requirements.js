
import {labRequirements,REQUIRED_SERVICES,LAB_SERVICES} from '../../../js/workflow-services.js';
import {institutionServices} from './configuration-accounts.js';
import {assertSemester} from '../../../js/semester.js';
import {isInactive} from './account-removal.js';
import {randomUUID} from 'node:crypto';
const fail=(message,code='invalid-argument')=>{throw Object.assign(Error(message),{code});};
export function workflowRequirementRoutes(app,{database,client}){
 const context=async actor=>{
  if(!['admin','super_admin'].includes(actor.role))fail('Administrator access required.','permission-denied');
  const id=actor.managementDepartmentId,semester=assertSemester(actor.managementSemester);
  const department=id&&await database.collection('departments').findOne({_id:id,status:'active'});
  if(!department)fail('Select an active department.');
  return {id,semester,department};
 };
 app.get('/api/administration/workflow-requirements',async(req,res)=>{
  const {id,semester,department}=await context(req.actor),config=await database.collection('departmentWorkflows').findOne({_id:id})||{},services=await institutionServices(database);
  res.json({department:{id,name:department.name,code:department.code},semester,mandatory:REQUIRED_SERVICES,services,semesters:Array.from({length:8},(_,i)=>({semester:i+1,labs:labRequirements(config,i+1),source:config.labRequirements?.[i+1]?'configured':'default'}))});
 });
 app.post('/api/administration/workflow-requirements',async(req,res)=>{
  const {id,semester}=await context(req.actor);
  if(Object.keys(req.body).some(k=>!['semester',...LAB_SERVICES].includes(k))||req.body.semester!==semester||LAB_SERVICES.some(k=>typeof req.body[k]!=='boolean'))fail('Save only Physics/Chemistry requirements for the selected semester. Common services are mandatory.');
  const next=Object.fromEntries(LAB_SERVICES.map(k=>[k,req.body[k]])),services=await institutionServices(database),session=client.startSession();let changed=false;
  try{await session.withTransaction(async()=>{
   const old=await database.collection('departmentWorkflows').findOne({_id:id},{session})||{};
   for(const role of LAB_SERVICES.filter(k=>next[k])){
    const uid=old[role]||services[role]?.uid,user=uid&&await database.collection('users').findOne({_id:uid,role},{session});
    if(!user||isInactive(user)||user.authDisabled===true||user.scope!=='institution'&&user.departmentId!==id)fail('Configure an active '+role+' approver before enabling it.');
   }
   const before=labRequirements(old,semester);if(LAB_SERVICES.every(k=>before[k]===next[k]))return;
   await database.collection('departmentWorkflows').updateOne({_id:id},{$set:{departmentId:id,['labRequirements.'+semester]:next,updatedAt:new Date()}},{upsert:true,session});
   await database.collection('superAdminAudit').insertOne({_id:randomUUID(),action:'WORKFLOW_LAB_REQUIREMENTS_UPDATED',actorId:req.actor.uid,actorRole:req.actor.role,departmentId:id,semester,before,after:next,reason:'Explicit semester-specific lab configuration; existing requests remain unchanged',timestamp:new Date()},{session});changed=true;
  });}finally{await session.endSession();}
  res.json({saved:true,changed,semester,labs:next,existingRequestsChanged:false});
 });
}
