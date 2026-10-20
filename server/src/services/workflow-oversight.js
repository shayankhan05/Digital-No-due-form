import {createHash,randomUUID} from 'node:crypto';
import {departmentOf} from './department-master.js';
import {stageReady,recomputeEffectiveWorkflow,effectiveRequest} from './workflow-model.js';
const fail=(message,code='invalid-argument')=>{throw Object.assign(new Error(message),{code});};
const officeDecision=r=>r.officeApproval|| (r.issuedAt?{status:'approved',actorId:r.issuedById,actedAt:r.issuedAt}: {status:'pending'});
export async function workflowTimeline(store,raw){
 const r=effectiveRequest(raw),rows=[],originalRows=await store.database.collection('approvals').find({$or:[{requestId:raw._id},{__parent:raw._id}]}).toArray(),originals=new Map(originalRows.map(a=>[a._id,a]));
 const actorIds=[...new Set([...Object.values(r.approvalItems||{}).map(i=>i.approverId),...['mentor','hod','office'].map(k=>r[k+'Id']),...originalRows.map(a=>a.actorId),...Object.values(r.effectiveOverrides||{}).map(o=>o.actorId)].filter(Boolean))],users=await store.database.collection('users').find({_id:{$in:actorIds}},{projection:{name:1}}).toArray(),people=new Map(users.map(u=>[u._id,u.name]));
 const person=async uid=>!uid?'Not assigned':people.get(uid)||'Former staff member';
 for(const [key,item]of Object.entries(r.approvalItems||{})){
  const original=originals.get(raw._id+'/'+key)||{status:raw.approvalStates?.[key]||'pending'};
  rows.push({key,stage:'Stage 1',label:item.label||item.subjectName||item.subjectCode||item.approverType,actor:await person(item.approverId),original,effective:r.approvalStates[key],locked:false});
 }
 for(const key of ['mentor','hod','office']){
  const original=key==='office'?officeDecision(raw):raw[key+'Approval']||{status:'pending'};
  const decision=key==='office'?officeDecision(r):r[key+'Approval']||{status:'pending'};
  rows.push({key,stage:key==='mentor'?'Stage 2':key==='hod'?'Stage 3':'Stage 4',label:key==='office'?'Department Office':key==='hod'?'HOD':'Mentor',actor:await person(r[key+'Id']),original,effective:decision.status,locked:!stageReady(r,key)});
 }
 for(const row of rows){row.override=r.effectiveOverrides?.[row.key]||null;row.originalActor=await person(row.original.actorId||row.original.actedById||raw[row.key+'Id']);row.overrideActor=row.override?await person(row.override.actorId):null;row.suspended=row.locked&&['approved','rejected'].includes(row.effective);row.canOverride=['approved','rejected'].includes(row.effective)&&!row.locked;}
 return rows;
}
export async function overrideDecision(store,actor,id,input){
 if(actor.role!=='super_admin')fail('Only Super Admin may override workflow decisions.','permission-denied');
 const {approvalId,decision,version,confirmation,requestKey}=input,reason=String(input.reason||'').trim();
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!['approved','rejected'].includes(decision)||reason.length<5||reason.length>2000||confirmation!==true||!Number.isSafeInteger(version)||!/^[A-Za-z0-9_-]{8,100}$/.test(requestKey||''))fail('Confirm the override and provide a reason, current version and operation key.');
 const overrideId=createHash('sha256').update(actor.uid+':'+id+':'+requestKey).digest('hex');
 await store.runTransaction(async tx=>{
  const ref=tx.store.doc('noDueRequests/'+id),raw=(await tx.get(ref)).data();if(!raw)fail('Request not found.');
  if(actor.managementDepartmentId&&await departmentOf(tx.store.database,'noDueRequests',raw)!==actor.managementDepartmentId)fail('Request belongs to another department.','permission-denied');
  const old=await tx.get(tx.store.doc('workflowOverrides/'+overrideId));if(old.exists)return;
  if((raw.version||0)!==version)fail('Request changed. Reload before overriding.','already-exists');
  const latest=await tx.store.database.collection('noDueRequests').findOne({studentId:raw.studentId},{session:tx.store.session,sort:{createdAt:-1,_id:-1}});
  if(latest?._id!==id)fail('A newer request exists. Historical requests are read-only.');
  const competing=await tx.store.database.collection('noDueRequests').findOne({studentId:raw.studentId,_id:{$ne:id},status:{$in:['pending_stage1','pending_mentor','pending_hod','pending_office','cleared','rejected']}},{session:tx.store.session});
  if(competing)fail('Another active request exists. Resolve it before overriding this request.');
  const studentRef=tx.store.doc('students/'+raw.studentId),student=(await tx.get(studentRef)).data();if(!student)fail('Student profile is unavailable.');
  tx.update(studentRef,{requestRevision:(student.requestRevision||0)+1});
  const r=effectiveRequest(raw),item=r.approvalItems?.[approvalId];
  if(!item&&!['mentor','hod','office'].includes(approvalId))fail('Unknown approval.');
  const original=item?(await tx.get(tx.store.doc(`noDueRequests/${id}/approvals/${approvalId}`))).data():approvalId==='office'?officeDecision(raw):raw[approvalId+'Approval'];
  const current=item?r.approvalStates[approvalId]:approvalId==='office'?officeDecision(r).status:r[approvalId+'Approval']?.status;
  if(!['approved','rejected'].includes(current)||current===decision)fail('Choose a different decision on a completed approval.');
  if(!item&&!stageReady(r,approvalId))fail('Earlier stages must be approved before overriding this stage.');
  if(!original)fail('Original decision record is missing.');
  const at=new Date(),event={_id:overrideId,requestId:id,studentId:r.studentId,departmentId:await departmentOf(tx.store.database,'noDueRequests',raw),approvalId,originalDecisionId:item?id+'/'+approvalId:id+'/'+approvalId+'/'+(original.actedAt?.toISOString?.()||'issued'),originalDecision:original.originalDecision||original,previousEffectiveDecision:current,decision,actorId:actor.uid,actorName:actor.name||'Super Admin',reason,at};
  const overlays={...raw.effectiveOverrides,[approvalId]:{id:overrideId,decision,reason,actorId:actor.uid,at}},next=effectiveRequest({...raw,effectiveOverrides:overlays}),patch=recomputeEffectiveWorkflow(next);
  // Request status is a derived cache. Original approval documents and embedded
  // Mentor/HOD/Office decisions are never overwritten by an override.
  tx.create(tx.store.doc('workflowOverrides/'+overrideId),event);
  const activity={action:'super_admin_override',actorId:actor.uid,actorName:event.actorName,actorType:'super_admin',approvalType:item?.approverType||approvalId,subjectCode:item?.subjectCode||null,reason,decision,approvalId,status:patch.status,createdAt:at};
  tx.update(ref,{...patch,effectiveOverrides:overlays,version:version+1,updatedAt:at,lastOverrideId:overrideId,lastApprovalId:approvalId,lastEvent:activity,lastRejection:decision==='rejected'?activity:patch.status==='rejected'?raw.lastRejection||null:null});
  tx.create(tx.store.doc('superAdminAudit/'+randomUUID()),{action:'SUPER_ADMIN_OVERRIDE',actorId:actor.uid,actorName:event.actorName,studentId:r.studentId,target:r.studentId,departmentId:event.departmentId,requestId:id,approvalId,previous:current,decision,reason,summary:`${r.studentName} — ${r.usn}: ${item?.label||approvalId}, ${current} → ${decision}. ${reason}`,timestamp:at,overrideId});
  tx.set(tx.store.doc(`users/${r.studentId}/notifications/${id}_override_${overrideId}`),{requestId:id,studentId:r.studentId,type:'super_admin_override',message:`${item?.label||approvalId}: ${decision}. ${reason}`,reason,decision,actorName:event.actorName,actorType:'super_admin',approvalType:item?.approverType||approvalId,read:false,createdAt:at});
 });return {saved:true,overrideId};
}
export function oversightRoutes(app,{store,database}){
 const superOnly=actor=>{if(actor.role!=='super_admin')fail('Super Admin access required.','permission-denied');};
 app.get('/api/oversight/requests',async(req,res)=>{
  superOnly(req.actor);const departmentId=req.actor.managementDepartmentId||req.query.departmentId;
  if(typeof departmentId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(departmentId))fail('Select a department.');const department=await database.collection('departments').findOne({_id:departmentId});if(!department)fail('Select a department.');
  const q={},term=String(req.query.term||'').trim();if(term.length>150)fail('Search is too long.');
  // Resolve department from the student as well as historical request references.
  const students=await database.collection('students').find({departmentId},{projection:{_id:1}}).toArray();
  q.$or=[{departmentId},{departmentId:{$in:[null,'']},department:{$in:[department.code,department.name]}},{departmentId:{$in:[null,'']},department:{$in:[null,'']},studentId:{$in:students.map(s=>s._id)}}];
  if(term){const rx=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');q.$and=[{$or:['_id','studentName','usn'].map(f=>({[f]:{$regex:rx,$options:'i'}}))}];}
  if(req.query.status){if(!['pending_stage1','pending_mentor','pending_hod','cleared','rejected','issued'].includes(req.query.status))fail('Invalid status.');q.status=req.query.status;}
  if(req.query.date){const from=new Date(req.query.date);if(!Number.isFinite(+from))fail('Invalid date.');q.createdAt={$gte:from,$lt:new Date(+from+86400000)};}
  const page=Math.max(1,Number(req.query.page)||1);if(!Number.isSafeInteger(page)||page>10000)fail('Invalid page.');
  const total=await database.collection('noDueRequests').countDocuments(q),rows=await database.collection('noDueRequests').find(q).sort({createdAt:-1,_id:1}).skip((page-1)*20).limit(20).toArray();
  res.json({rows:rows.map(r=>({id:r._id,studentName:r.studentName,usn:r.usn,status:r.status,createdAt:r.createdAt,version:r.version||0})),total,page,pages:Math.ceil(total/20)});
 });
 app.get('/api/oversight/requests/:id',async(req,res)=>{
  superOnly(req.actor);const raw=await database.collection('noDueRequests').findOne({_id:req.params.id});if(!raw)fail('Request not found.');
  if(req.actor.managementDepartmentId&&await departmentOf(database,'noDueRequests',raw)!==req.actor.managementDepartmentId)fail('Wrong department.','permission-denied');
  const overrides=await database.collection('workflowOverrides').find({requestId:raw._id}).sort({at:1,_id:1}).toArray();
  const latest=await database.collection('noDueRequests').findOne({studentId:raw.studentId},{sort:{createdAt:-1,_id:-1}}),timeline=await workflowTimeline(store,raw);if(latest?._id!==raw._id)for(const row of timeline)row.canOverride=false;res.json({id:raw._id,studentName:raw.studentName,usn:raw.usn,status:raw.status,createdAt:raw.createdAt,version:raw.version||0,timeline,overrides});
 });
 app.post('/api/oversight/requests/:id/override',async(req,res)=>res.json(await overrideDecision(store,req.actor,req.params.id,req.body)));
}
