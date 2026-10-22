import {authorizeAccountTarget} from './department-master.js';
import {isInactive} from './account-removal.js';
export function bulkExitRoutes(app,{database}){
 app.post('/api/admin/accounts/exit-preview',async(req,res)=>{
  if(!['super_admin','admin'].includes(req.actor.role))throw Object.assign(Error('Administrator access required.'),{code:'permission-denied'});
  const {kind,identifiers,action}=req.body;if(!['student','faculty'].includes(kind)||!['deactivate','reactivate','institutional-exit','delete'].includes(action)||!Array.isArray(identifiers)||!identifiers.length||identifiers.length>2000)throw Error('Choose 1–2000 student USNs or faculty employee IDs.');
  const supplied=identifiers.map(v=>String(v||'').trim().toUpperCase()),records=await database.collection(kind==='student'?'students':'users').find({[kind==='student'?'usn':'facultyId']:{$in:supplied}}).collation({locale:'en',strength:2}).toArray(),users=kind==='student'?await database.collection('users').find({_id:{$in:records.map(r=>r._id)}}).toArray():records,byUid=new Map(users.map(u=>[u._id,u])),byIdentifier=new Map();
  for(const row of records){const key=String(row[kind==='student'?'usn':'facultyId']||'').toUpperCase();byIdentifier.set(key,[...(byIdentifier.get(key)||[]),row]);}
  const departments=await database.collection('departments').find({}).toArray(),leaders=new Set(departments.flatMap(d=>[d.adminId,d.departmentAdminId,d.hodId]).filter(Boolean)),assigned=new Set((await database.collection('offerings').find({teacherId:{$in:users.map(u=>u._id)},active:{$ne:false}},{projection:{teacherId:1}}).toArray()).map(o=>o.teacherId)),seen=new Set(),rows=[];
  for(let index=0;index<identifiers.length;index++){
   const identifier=String(identifiers[index]||'').trim().toUpperCase();let user,error;
   if(!/^[A-Z0-9_-]{1,80}$/.test(identifier))error='Invalid identifier.';
   else if(seen.has(identifier))error='Duplicate identifier in CSV.';seen.add(identifier);
   if(!error){const matches=byIdentifier.get(identifier)||[];if(matches.length!==1)error='No unique institutional account matches this identifier.';else user=byUid.get(matches[0]._id);if(!user)error||='Institutional user profile is missing.';}
   if(user){if(req.actor.managementDepartmentId&&user.departmentId!==req.actor.managementDepartmentId)throw Object.assign(Error('Account belongs to another department.'),{code:'permission-denied'});if(kind==='faculty'&&user.role==='student')error='Expected a faculty employee ID.';}
   let classification=error?'INVALID':'ELIGIBLE',reason=error||(action==='deactivate'?'Eligible for deactivation.':action==='institutional-exit'?'Eligible for institutional exit.':action==='delete'?'Eligible for permanent deletion.':'Eligible for reactivation.');
   if(user&&!error){if(user._id===req.actor.uid||user.role==='super_admin'){classification='PROTECTED';reason='Your own account and Super Admin accounts are protected.';}else if(['office','library','accounts','physics_lab','chemistry_lab','sports'].includes(user.role)){classification='PROTECTED';reason='Shared service account.';}else if(leaders.has(user._id)&&action!=='reactivate'){classification='PROTECTED';reason='Current department leadership is protected.';}else if(action==='deactivate'&&assigned.has(user._id)){classification='PROTECTED';reason='Reassign active teaching responsibilities first.';}else if(req.actor.role==='admin'&&!['student','subject_faculty','mentor'].includes(user.role)){classification='PROTECTED';reason='Department Admin can manage only students and faculty.';}else if(['exited','exiting'].includes(user.accountStatus)){classification='PROTECTED';reason='This identity has left the institution. Explicit restoration is required.';}else if(action==='deactivate'&&isInactive(user)||action==='reactivate'&&!isInactive(user)){classification='SKIPPED';reason='Account is already '+(isInactive(user)?'inactive.':'active.');}}
   rows.push({index,identifier,uid:user?._id,name:user?.name,classification,reason,status:user&&(action==='reactivate'&&classification==='SKIPPED'&&!isInactive(user)?'ALREADY_ACTIVE':isInactive(user)?'inactive':'active')});
  }
  res.json({rows,total:rows.length,invalid:rows.filter(r=>r.classification==='INVALID').length,eligible:rows.filter(r=>r.classification==='ELIGIBLE').length});
 });
}
