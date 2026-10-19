import {isVisibleScheme} from '../../../js/scheme-visibility.js';
import {sectionDetailRoutes} from './section-details.js';
import {retireHodAuthority} from './account-authority.js';
import {directoryPage} from './directory.js';
import {eligibleConfigurationAccount,institutionServices} from './configuration-accounts.js';
import {assertUniqueDepartment,departmentNameKey} from './department-uniqueness.js';
import {sectionMaster,saveSection} from './section-master.js';
import {randomUUID} from 'node:crypto';
import {departmentCode} from '../../../js/department.js';
import {isInactive} from './account-removal.js';
export const departmentalRoles=['admin','student','subject_faculty','mentor','hod','office'];
const fail=(message,code='invalid-argument')=>{throw Object.assign(new Error(message),{code});};
const key=v=>String(v||'').trim().replace(/\s+/g,' ').toLowerCase();
export async function departmentOf(db,collection,data,seen=new Set()){
 if(!data)return null;if(data.scope==='institution')return null;
 if(data.departmentId)return data.departmentId;
 if(data.department){const code=departmentCode(data.department);const d=await db.collection('departments').findOne({$or:[{codeKey:key(code)},{nameKey:{$in:[key(data.department),departmentNameKey(data.department)]}}]});if(d)return d.creationDigest?null:d._id;}
 const refs=['marks','noDueRequests','approvals','hallTickets','notifications'].includes(collection)?['studentId']:collection==='enrollments'?['studentId','offeringId']:collection==='offerings'?['teacherId']:collection==='assignments'?['offeringId']:[];
 for(const field of refs){const id=data[field],target=field==='studentId'?'students':field==='teacherId'?'users':'offerings',tag=target+'/'+id;if(id&&!seen.has(tag)){seen.add(tag);const result=await departmentOf(db,target,await db.collection(target).findOne({_id:id}),seen);if(result)return result;}}
 return null;
}
export async function assertDepartment(store,actor,collection,data){
 if(!actor.managementDepartmentId)return;
 const id=await departmentOf(store.database,collection,data);
 if(id!==actor.managementDepartmentId&&data?.scope!=='institution')fail('This record belongs to another department.','permission-denied');
}
export async function scopedAdminInput(database,actor,input){
 const masters=await database.collection('departments').find({}).toArray();if(!masters.length)return input;
 if(actor.role==='admin'&&input.action==='repairDemoProfile')fail('Only Super Admin can repair institutional identities.','permission-denied');
 const selected=actor.managementDepartmentId&&masters.find(d=>d._id===actor.managementDepartmentId);
 const prepare=async raw=>{if(!raw)return raw;const row={...raw};if(actor.role==='admin'&&!['student','subject_faculty','mentor'].includes(row.role||'student'))fail('Department Admin cannot provision leadership or shared accounts.','permission-denied');if(row.scope==='institution'&&!departmentalRoles.includes(row.role)&&!row.department&&!row.departmentId)return {...row,department:''};const department=masters.find(d=>d._id===row.departmentId||key(d.code)===key(departmentCode(row.department))||key(d.name)===key(row.department));
 if(selected&&department&&department._id!==selected._id)fail('CSV/account department differs from the selected management department.','permission-denied');
 const chosen=department||(!row.department?selected:null);if(!chosen)fail('Choose a department from the department master.');if(chosen.status!=='active')fail('Department is inactive.');row.department=chosen.code;row.departmentId=chosen._id;return row;};
 if(input.rows)input={...input,rows:await Promise.all(input.rows.map(prepare))};if(input.row)input={...input,row:await prepare(input.row)};
 if(input.action==='mapClass')input={...input,...await prepare(input)};
 if(input.uid&&actor.role==='admin')await authorizeAccountTarget(database,actor,await database.collection('users').findOne({_id:input.uid}));if(input.uid&&selected){const user=await database.collection('users').findOne({_id:input.uid});if(user?.scope!=='institution'&&(await departmentOf(database,'users',user))!==selected._id)fail('Account belongs to another department.','permission-denied');}
 return input;
}
export async function departmentContext(req,res,next){try{
 const id=req.get('X-Department-Id');
 if(req.actor.role==='admin'&&await req.departmentDatabase.collection('departments').countDocuments()){
   const own=await departmentOf(req.departmentDatabase,'users',{...req.actor,scope:'department'});if(!own)fail('Your department administrator mapping needs configuration.','permission-denied');
   if(id&&id!==own)fail('Administrators cannot select another department.','permission-denied');req.actor={...req.actor,managementDepartmentId:own,departmentId:own,scope:'department'};return next();
 }
 if(!id)return next();if(req.actor.role!=='super_admin')fail('Only Super Admin can select a management department.','permission-denied');
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))fail('Invalid department context.');
 const d=await req.departmentDatabase.collection('departments').findOne({_id:id});if(!d)fail('Department not found.');req.actor={...req.actor,managementDepartmentId:id};next();
}catch(e){next(e);}}
export async function authorizeAccountTarget(database,actor,target){
 const fresh=await database.collection('users').findOne({_id:actor.uid});if(!fresh||!['admin','super_admin'].includes(fresh.role)||isInactive(fresh))fail('Administrator access required.','permission-denied');
 if(!target)fail('Account not found.');if(target.role==='super_admin'||target._id===actor.uid)fail('Super Admin and your own account are protected.','permission-denied');
 const exists=await database.collection('departments').countDocuments();
 if(fresh.role==='admin'&&exists){const own=await departmentOf(database,'users',{...fresh,scope:'department'}),other=await departmentOf(database,'users',target);if(!own||own!==other||target.scope==='institution'||!['student','subject_faculty','mentor'].includes(target.role))fail('Department Admin can manage only students, faculty and mentors in their own department.','permission-denied');}
 if(fresh.role==='super_admin'&&actor.managementDepartmentId&&target.scope!=='institution'&&(await departmentOf(database,'users',target))!==actor.managementDepartmentId)fail('Account belongs to another department.','permission-denied');
 return {...fresh,uid:fresh._id};
}
export function departmentRoutes(app,{database,client,createDepartment}){
 sectionDetailRoutes(app,{database,client});
 const audit=async(session,actor,action,target)=>database.collection('superAdminAudit').insertOne({_id:randomUUID(),actorId:actor.uid,actorUid:actor.uid,action,target,departmentId:actor.managementDepartmentId||null,reason:'Explicit administrator configuration change',operationType:action,timestamp:new Date()},{session});
 app.post('/api/administration/account-scope',async(req,res)=>{
  if(req.actor.role!=='super_admin')fail('Only Super Admin configures shared service scope.','permission-denied');
  const {uid,scope,departmentId}=req.body;if(!['institution','department'].includes(scope))fail('Choose institution or department scope.');
  const u=await database.collection('users').findOne({_id:uid,role:{$in:['office','library','accounts','physics_lab','chemistry_lab']}});if(!u||isInactive(u))fail('Choose an active shared service account.');if(u.role==='accounts'&&scope!=='institution')fail('Accounts must be institution-wide.');if(u.role==='office'&&scope!=='department')fail('Office must belong to a department.');
  const d=scope==='department'&&await database.collection('departments').findOne({_id:departmentId,status:'active'});if(scope==='department'&&!d)fail('Choose an active department.');
  if(d&&await database.collection('departmentWorkflows').findOne({_id:{$ne:d._id},$or:[{officeId:uid},{library:uid},{accounts:uid}]}))fail('Reassign this shared account in other departments before restricting its scope.');
  const session=client.startSession();try{await session.withTransaction(async()=>{await database.collection('users').updateOne({_id:uid},scope==='institution'?{$set:{scope,departmentId:null},$unset:{department:''}}:{$set:{scope,departmentId:d._id,department:d.code}},{session});await audit(session,req.actor,'shared_service_scope_updated',uid);});}finally{await session.endSession();}res.json({saved:true});
 });
 app.get('/api/administration/masters',async(req,res)=>{
  if(!['admin','super_admin'].includes(req.actor.role))fail('Administrator access required.','permission-denied');
  const [services,policy,departments,schemes,leadership,workflow]=await Promise.all([
   institutionServices(database),database.collection('institutionPolicy').findOne({_id:'institution'}),
   database.collection('departments').find(req.actor.role==='admin'?{_id:req.actor.managementDepartmentId}:{}).sort({code:1}).toArray(),
   database.collection('schemes').find({}).sort({code:1}).toArray(),
   req.actor.role==='super_admin'?database.collection('users').find({role:{$in:['admin','hod']}}).toArray():Promise.resolve([]),
   database.collection('users').find({role:{$in:['hod','office','library','accounts','physics_lab','chemistry_lab']},accountStatus:{$nin:['inactive','deleted','deactivating','deleting','exited','exiting']}}).toArray()
  ]);
  res.json({institutionServices:services,sections:sectionMaster(policy||{}),departments,schemes:schemes.filter(isVisibleScheme),leadershipAccounts:leadership.map(u=>({uid:u._id,name:u.name,email:u.email,role:u.role,departmentId:u.departmentId,facultyId:u.facultyId,accountStatus:u.accountStatus||'active',eligible:eligibleConfigurationAccount(u)})),workflowAccounts:workflow.filter(u=>eligibleConfigurationAccount(u)&&(req.actor.role==='super_admin'||u.scope==='institution'||u.departmentId===req.actor.managementDepartmentId)).map(u=>({uid:u._id,name:u.name,email:u.email,role:u.role,scope:u.scope,departmentId:u.departmentId}))});
 });
 app.get('/api/administration/leadership-candidates',async(req,res)=>{
  if(req.actor.role!=='super_admin')fail('Only Super Admin assigns leadership.','permission-denied');
  const id=req.actor.managementDepartmentId||req.query.departmentId,dep=id&&await database.collection('departments').findOne({_id:id});
  if(!dep)fail('Select an existing department.');
  const position=req.query.position;if(!['admin','hod'].includes(position))fail('Choose a leadership position.');
  const term=String(req.query.term||'').trim(),page=Math.max(1,Number(req.query.page)||1);if(term.length>150||!Number.isSafeInteger(page)||page>10000)fail('Invalid search.');
  const match={departmentId:id,role:{$in:[position,'subject_faculty','mentor']},accountStatus:{$nin:['inactive','deleted','deactivating','deleting','exited','exiting']},authDisabled:{$ne:true},configurationSelectable:{$ne:false}};
  const current=position==='hod'?dep.hodId:dep.adminId||dep.departmentAdminId;if(current)match._id={$ne:current};
  if(term){const regex=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');match.$or=['name','email','facultyId'].map(f=>({[f]:{$regex:regex,$options:'i'}}));}
  // Filter before paging so hidden/ineligible accounts cannot hide real candidates.
  const eligible=(await database.collection('users').find(match).sort({name:1,_id:1}).toArray()).filter(eligibleConfigurationAccount),total=eligible.length;
  res.json({rows:eligible.slice((page-1)*25,page*25).map(u=>({uid:u._id,name:u.name,email:u.email,facultyId:u.facultyId,role:u.role,departmentId:u.departmentId})),total,page,pages:Math.ceil(total/25)});
 });
 app.post('/api/administration/department-retry',async(req,res)=>{if(req.actor.role!=='super_admin')fail('Only Super Admin manages department setup.','permission-denied');fail('Automatic initial Admin provisioning is disabled. Open Department Setup and assign leadership explicitly.','failed-precondition');});
 app.post('/api/administration/master',async(req,res)=>{
 if(req.actor.role!=='super_admin')fail('Only Super Admin manages departments and schemes.','permission-denied');
 const {kind,id,...input}=req.body;if(kind==='sections')return res.json(await saveSection(database,client,req.actor,req.body));if(kind==='departments'&&!id)return res.json(await createDepartment(req.actor,req.body));if(!['departments','schemes'].includes(kind))fail('Choose department or scheme.');
 const code=String(input.code||'').trim().toUpperCase(),name=String(input.name||'').trim();if(!/^[A-Z0-9_-]{1,30}$/.test(code)||!name||name.length>150)fail('A valid code and name are required.');if(!['active','inactive'].includes(input.status))fail('Choose active or inactive.');
 const session=client.startSession();let document;try{await session.withTransaction(async()=>{const col=database.collection(kind),old=id?await col.findOne({_id:id},{session}):null;if(id&&!old)fail('Record not found.');if(old?.status==='provisioning')fail('Retry the pending department setup to finish provisioning its administrator.');if(old?.retiredToDepartmentId&&input.status==='active')fail('This department was retired in favor of its canonical department.');if(old&&old.code!==code)fail('Codes are stable identifiers; edit the name or status instead.');
 if(kind==='departments')await assertUniqueDepartment(database,{code,name,id,session});const clash=await col.findOne({$or:[{codeKey:key(code)},{nameKey:key(name)}],...(id?{_id:{$ne:id}}:{})},{session});if(clash)fail('Department/scheme code or name already exists.','already-exists');
 const scopedScheme=kind==='schemes'&&req.actor.managementDepartmentId;
 if(scopedScheme&&old?.scope==='department'&&!old.departmentIds?.includes(scopedScheme))fail('Scheme belongs to another department.','permission-denied');
 const scope=kind==='schemes'?(scopedScheme?(old?(old.scope||'institution'):'department'):(input.scope==='department'?'department':'institution')):undefined,departmentIds=scope==='department'?(scopedScheme?(old?.departmentIds||[scopedScheme]):[...new Set(input.departmentIds||[])]):[];
 if(scope==='department'&&!departmentIds.length)fail('Select applicable departments.');for(const did of departmentIds)if(!await database.collection('departments').findOne({_id:did},{session}))fail('Unknown department.');
 const details=kind==='departments'?{schemeIds:input.schemeIds||old.schemeIds||[],sections:input.sections||old.sections||['A','B','C']}:{};for(const sid of details.schemeIds||[])if(!await database.collection('schemes').findOne({_id:sid},{session}))fail('Unknown scheme.');if(details.sections&&(!Array.isArray(details.sections)||details.sections.some(v=>! /^[A-Z0-9-]{1,10}$/.test(v))))fail('Choose valid sections.');document={...(old||{}),...details,_id:old?._id||randomUUID(),code,name,codeKey:key(code),nameKey:kind==='departments'?departmentNameKey(name):key(name),status:input.status,createdAt:old?.createdAt||new Date(),updatedAt:new Date(),...(kind==='schemes'?{scope,departmentIds}:{})};await col.replaceOne({_id:document._id},document,{upsert:true,session});if(kind==='schemes'&&scopedScheme&&!old)await database.collection('departments').updateOne({_id:scopedScheme},{$addToSet:{schemeIds:document._id},$set:{updatedAt:new Date()}},{session});await audit(session,req.actor,kind+'_'+(!old?'created':old.status!==document.status?document.status==='inactive'?'deactivated':'activated':'edited'),document._id);});}finally{await session.endSession();}
 document.referencesMapped=0;res.json(document);
 });
 app.post('/api/administration/directory',async(req,res)=>res.json(await directoryPage(database,req.actor,req.body)));
 app.get('/api/administration/workflow/:id',async(req,res)=>{if(!['super_admin','admin'].includes(req.actor.role))fail('Administrator access required.','permission-denied');if(req.actor.managementDepartmentId&&req.params.id!==req.actor.managementDepartmentId)fail('Wrong department context.','permission-denied');res.json(await database.collection('departmentWorkflows').findOne({_id:req.params.id})||{});});
 app.post('/api/administration/workflow',async(req,res)=>{if(!['admin','super_admin'].includes(req.actor.role))fail('Only administrators configure department workflow.','permission-denied');const id=req.actor.managementDepartmentId;if(!id)fail('Select a department first.');const currentDepartment=await database.collection('departments').findOne({_id:id});if(req.actor.role==='admin'&&req.body.hodId!==currentDepartment?.hodId)fail('Only Super Admin can replace department leadership.','permission-denied');const values={},fixed=req.body.serviceMode==='institution'?await institutionServices(database):null;if(fixed&&Object.values(fixed).some(u=>!u))fail('Configure the canonical institution services before saving.');for(const[field,role]of [['hodId','hod'],['officeId','office'],['library','library'],['accounts','accounts'],...(fixed||req.body.physics_lab||req.body.chemistry_lab?[['physics_lab','physics_lab'],['chemistry_lab','chemistry_lab']]:[])]){const uid=req.body[field];if(fixed&&!['hodId','officeId'].includes(field)&&uid!==fixed[field]?.uid)fail('Institution service assignment does not match the canonical configuration.');const u=uid&&await database.collection('users').findOne({_id:uid,role});if(!u||isInactive(u)||(field==='hodId'&&!eligibleConfigurationAccount(u)))fail('Choose an active '+role+' account.');if(field==='officeId'&&(u.scope!=='department'||(await departmentOf(database,'users',u))!==id))fail('Choose an active Office belonging to this department.');if(field==='accounts'&&u.scope!=='institution')fail('Accounts must be institution-wide.');if(u.scope!=='institution'&&(await departmentOf(database,'users',u))!==id)fail(role+' belongs to another department.');values[field]=uid;}values.officeScopeVersion=2;const session=client.startSession();try{await session.withTransaction(async()=>{const previousWorkflow=await database.collection('departmentWorkflows').findOne({_id:id},{session});if(previousWorkflow?.officeId!==values.officeId)await audit(session,req.actor,'WORKFLOW_OFFICE_CHANGED',id);const before=await database.collection('departments').findOne({_id:id},{session}),previous=before.hodId||(await database.collection('departmentWorkflows').findOne({_id:id},{session}))?.hodId;if(previous!==values.hodId){if(previous)await retireHodAuthority(database,session,previous,id,values.hodId);await database.collection('departmentLeadershipHistory').insertOne({_id:randomUUID(),departmentId:id,position:'hod',oldId:previous||null,newId:values.hodId,changedBy:req.actor.uid,timestamp:new Date()},{session});}await database.collection('departments').updateOne({_id:id},{$set:{hodId:values.hodId}},{session});await database.collection('departmentWorkflows').updateOne({_id:id},{$set:{...values,departmentId:id,updatedAt:new Date()}},{upsert:true,session});await audit(session,req.actor,'department_workflow_hod_assignment_updated',id);});}finally{await session.endSession();}res.json({saved:true});});
}

// Additive operator migration. Never updates identity keys or workflow history.
export async function migrateDepartmentMaster(database,client,{apply=false}={}){
 const existing=await database.collection('departments').find({}).toArray(),departments=[...existing];if(!departments.some(d=>d.code==='ISE'))departments.push({_id:'dept_ISE',code:'ISE',name:'Information Science & Engineering',codeKey:'ise',nameKey:'information science & engineering',status:'active',createdAt:new Date(),updatedAt:new Date()});
 const ise=departments.find(d=>d.code==='ISE'),snap={};for(const name of ['users','students','subjects','offerings','enrollments','assignments'])snap[name]=await database.collection(name).find({}).toArray();
 const identified=new Map();for(const[name,rows]of Object.entries(snap))for(const r of rows){const d=departments.find(d=>key(d.code)===key(departmentCode(r.department))||key(d.name)===key(r.department));if(r.departmentId)identified.set(name+'/'+r._id,r.departmentId);else if(d)identified.set(name+'/'+r._id,d._id);}
 for(let pass=0;pass<4;pass++)for(const[name,rows]of Object.entries(snap))for(const r of rows){const tag=name+'/'+r._id;if(identified.has(tag))continue;const refs=name==='offerings'?[['users',r.teacherId]]:name==='enrollments'?[['students',r.studentId],['offerings',r.offeringId]]:name==='assignments'?[['offerings',r.offeringId]]:name==='subjects'?snap.offerings.filter(o=>o.subjectId===r._id).map(o=>['offerings',o._id]):[];const ids=[...new Set(refs.map(([c,id])=>identified.get(c+'/'+id)).filter(Boolean))];if(ids.length===1)identified.set(tag,ids[0]);}
 const changes=[];for(const[name,rows]of Object.entries(snap))for(const r of rows){const scope=name==='users'?(r.scope||(departmentalRoles.includes(r.role)?'department':'institution')):'department',did=identified.get(name+'/'+r._id);const fields={};if(name==='users'&&!r.scope)fields.scope=scope;if(scope==='department'&&did&&!r.departmentId)fields.departmentId=did;if(Object.keys(fields).length)changes.push({collection:name,id:r._id,fields});}
 const policy=await database.collection('institutionPolicy').findOne({_id:'institution'}),schemes=await database.collection('schemes').find({}).toArray(),codes=[...new Set(['2022',...(policy?.schemes||[]),...snap.students.map(s=>s.scheme)].filter(Boolean).map(String))];const additions=codes.filter(code=>!schemes.some(s=>s.code===code)).map(code=>({_id:'scheme_'+code,code,name:code+' Scheme',codeKey:key(code),nameKey:key(code+' Scheme'),scope:'institution',departmentIds:[],status:'active',createdAt:new Date(),updatedAt:new Date()}));
 const legacy=await database.collection('institutionPolicy').findOne({_id:'workflow'}),workflow=legacy&&!await database.collection('departmentWorkflows').findOne({_id:ise._id})?{...legacy,_id:ise._id,departmentId:ise._id}:null;
 if(apply){const session=client.startSession();try{await session.withTransaction(async()=>{for(const d of departments.filter(d=>!existing.some(e=>e._id===d._id)))await database.collection('departments').insertOne(d,{session});for(const s of additions)await database.collection('schemes').insertOne(s,{session});for(const c of changes)await database.collection(c.collection).updateOne({_id:c.id,...Object.fromEntries(Object.keys(c.fields).map(k=>[k,{$exists:false}]))},{$set:c.fields},{session});if(workflow)await database.collection('departmentWorkflows').insertOne(workflow,{session});});}finally{await session.endSession();}}
 return {departmentId:ise._id,departmentAdds:departments.length-existing.length,schemeAdds:additions.length,workflowAdds:workflow?1:0,counts:Object.fromEntries(Object.keys(snap).map(c=>[c,changes.filter(v=>v.collection===c).length])),changes};
}
