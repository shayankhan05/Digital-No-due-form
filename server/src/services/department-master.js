import {randomUUID} from 'node:crypto';
import {departmentCode} from '../../../js/department.js';
import {isInactive} from './account-removal.js';
export const departmentalRoles=['student','subject_faculty','mentor','hod'];
const fail=(message,code='invalid-argument')=>{throw Object.assign(new Error(message),{code});};
const key=v=>String(v||'').trim().replace(/\s+/g,' ').toLowerCase();
export async function departmentOf(db,collection,data,seen=new Set()){
 if(!data)return null;if(data.scope==='institution')return null;
 if(data.departmentId)return data.departmentId;
 if(data.department){const code=departmentCode(data.department);const d=await db.collection('departments').findOne({$or:[{codeKey:key(code)},{nameKey:key(data.department)}]});if(d)return d._id;}
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
 const selected=actor.managementDepartmentId&&masters.find(d=>d._id===actor.managementDepartmentId);
 const prepare=async raw=>{if(!raw)return raw;const row={...raw};const department=masters.find(d=>d._id===row.departmentId||key(d.code)===key(departmentCode(row.department))||key(d.name)===key(row.department));
 if(selected&&department&&department._id!==selected._id)fail('CSV/account department differs from the selected management department.','permission-denied');
 const chosen=department||(!row.department?selected:null);if(!chosen)fail('Choose a department from the department master.');if(chosen.status!=='active')fail('Department is inactive.');row.department=chosen.code;row.departmentId=chosen._id;return row;};
 if(input.rows)input={...input,rows:await Promise.all(input.rows.map(prepare))};if(input.row)input={...input,row:await prepare(input.row)};
 if(input.action==='mapClass')input={...input,...await prepare(input)};
 if(input.uid&&selected){const user=await database.collection('users').findOne({_id:input.uid});if(user?.scope!=='institution'&&(await departmentOf(database,'users',user))!==selected._id)fail('Account belongs to another department.','permission-denied');}
 return input;
}
export async function departmentContext(req,res,next){try{
 const id=req.get('X-Department-Id');if(!id)return next();if(req.actor.role!=='super_admin')fail('Only Super Admin can select a management department.','permission-denied');
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))fail('Invalid department context.');
 const d=await req.departmentDatabase.collection('departments').findOne({_id:id});if(!d)fail('Department not found.');req.actor={...req.actor,managementDepartmentId:id};next();
}catch(e){next(e);}}
export function departmentRoutes(app,{database,client}){
 const audit=async(session,actor,action,target)=>database.collection('superAdminAudit').insertOne({_id:randomUUID(),actorId:actor.uid,action,target,timestamp:new Date()},{session});
 app.post('/api/administration/account-scope',async(req,res)=>{
  if(req.actor.role!=='super_admin')fail('Only Super Admin configures shared service scope.','permission-denied');
  const {uid,scope,departmentId}=req.body;if(!['institution','department'].includes(scope))fail('Choose institution or department scope.');
  const u=await database.collection('users').findOne({_id:uid,role:{$in:['office','library','accounts','physics_lab','chemistry_lab']}});if(!u||isInactive(u))fail('Choose an active shared service account.');
  const d=scope==='department'&&await database.collection('departments').findOne({_id:departmentId,status:'active'});if(scope==='department'&&!d)fail('Choose an active department.');
  if(d&&await database.collection('departmentWorkflows').findOne({_id:{$ne:d._id},$or:[{officeId:uid},{library:uid},{accounts:uid}]}))fail('Reassign this shared account in other departments before restricting its scope.');
  const session=client.startSession();try{await session.withTransaction(async()=>{await database.collection('users').updateOne({_id:uid},scope==='institution'?{$set:{scope},$unset:{departmentId:''}}:{$set:{scope,departmentId:d._id,department:d.code}},{session});await audit(session,req.actor,'shared_service_scope_updated',uid);});}finally{await session.endSession();}res.json({saved:true});
 });
 app.get('/api/administration/masters',async(req,res)=>{if(!['admin','super_admin'].includes(req.actor.role))fail('Administrator access required.','permission-denied');res.json({departments:await database.collection('departments').find({}).sort({code:1}).toArray(),schemes:await database.collection('schemes').find({}).sort({code:1}).toArray(),workflowAccounts:(await database.collection('users').find({role:{$in:['hod','office','library','accounts','physics_lab','chemistry_lab']},accountStatus:{$nin:['inactive','deleted','deactivating']}}).toArray()).map(u=>({uid:u._id,name:u.name,email:u.email,role:u.role,scope:u.scope,departmentId:u.departmentId}))});});
 app.post('/api/administration/master',async(req,res)=>{
 if(req.actor.role!=='super_admin')fail('Only Super Admin manages departments and schemes.','permission-denied');
 const {kind,id,...input}=req.body;if(!['departments','schemes'].includes(kind))fail('Choose department or scheme.');
 const code=String(input.code||'').trim().toUpperCase(),name=String(input.name||'').trim();if(!/^[A-Z0-9_-]{1,30}$/.test(code)||!name||name.length>150)fail('A valid code and name are required.');if(!['active','inactive'].includes(input.status))fail('Choose active or inactive.');
 const session=client.startSession();let document;try{await session.withTransaction(async()=>{const col=database.collection(kind),old=id?await col.findOne({_id:id},{session}):null;if(id&&!old)fail('Record not found.');if(old&&old.code!==code)fail('Codes are stable identifiers; edit the name or status instead.');
 const clash=await col.findOne({$or:[{codeKey:key(code)},{nameKey:key(name)}],...(id?{_id:{$ne:id}}:{})},{session});if(clash)fail('Department/scheme code or name already exists.','already-exists');
 const scope=kind==='schemes'?(input.scope==='department'?'department':'institution'):undefined,departmentIds=scope==='department'?[...new Set(input.departmentIds||[])]:[];
 if(scope==='department'&&!departmentIds.length)fail('Select applicable departments.');for(const did of departmentIds)if(!await database.collection('departments').findOne({_id:did},{session}))fail('Unknown department.');
 document={...(old||{}),_id:old?._id||randomUUID(),code,name,codeKey:key(code),nameKey:key(name),status:input.status,createdAt:old?.createdAt||new Date(),updatedAt:new Date(),...(kind==='schemes'?{scope,departmentIds}:{})};await col.replaceOne({_id:document._id},document,{upsert:true,session});await audit(session,req.actor,kind+'_'+(!old?'created':old.status!==document.status?document.status==='inactive'?'deactivated':'activated':'edited'),document._id);});}finally{await session.endSession();}res.json(document);
 });
 app.post('/api/administration/directory',async(req,res)=>{
 if(!['super_admin','admin'].includes(req.actor.role))fail('Administrator access required.','permission-denied');const {role='',status='active',term=''}=req.body;if(String(term).length>150)fail('Search is too long.');
 const students=new Map((await database.collection('students').find({}).toArray()).map(s=>[s._id,s]));const rows=[];
 for(const u of await database.collection('users').find(role?{role}:{}).toArray()){const s=students.get(u._id),d=await departmentOf(database,'users',u);if(req.actor.managementDepartmentId&&d!==req.actor.managementDepartmentId)continue;if(req.body.departmentId&&d!==req.body.departmentId)continue;if(status!=='all'&&(status==='inactive')!==isInactive(u))continue;const r={uid:u._id,name:u.name,email:u.email,role:u.role,departmentId:d,department:s?.department||u.department,identifier:s?.usn||u.facultyId||'',scope:u.scope|| (departmentalRoles.includes(u.role)?'department':'institution'),status:isInactive(u)?'inactive':'active'};if(key(term)&&![r.name,r.email,r.identifier].some(v=>key(v).includes(key(term))))continue;rows.push(r);}
 rows.sort((a,b)=>String(a.identifier).localeCompare(String(b.identifier),undefined,{numeric:true,sensitivity:'base'}));res.json({rows});
 });
 app.get('/api/administration/workflow/:id',async(req,res)=>{if(!['super_admin','admin'].includes(req.actor.role))fail('Administrator access required.','permission-denied');if(req.actor.managementDepartmentId&&req.params.id!==req.actor.managementDepartmentId)fail('Wrong department context.','permission-denied');res.json(await database.collection('departmentWorkflows').findOne({_id:req.params.id})||{});});
 app.post('/api/administration/workflow',async(req,res)=>{if(req.actor.role!=='super_admin')fail('Only Super Admin configures department workflow.','permission-denied');const id=req.actor.managementDepartmentId;if(!id)fail('Select a department first.');const values={};for(const[field,role]of [['hodId','hod'],['officeId','office'],['library','library'],['accounts','accounts']]){const uid=req.body[field],u=uid&&await database.collection('users').findOne({_id:uid,role});if(!u||isInactive(u))fail('Choose an active '+role+' account.');if(u.scope!=='institution'&&(await departmentOf(database,'users',u))!==id)fail(role+' belongs to another department.');values[field]=uid;}const session=client.startSession();try{await session.withTransaction(async()=>{await database.collection('departmentWorkflows').updateOne({_id:id},{$set:{...values,departmentId:id,updatedAt:new Date()}},{upsert:true,session});await audit(session,req.actor,'department_workflow_hod_assignment_updated',id);});}finally{await session.endSession();}res.json({saved:true});});
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
