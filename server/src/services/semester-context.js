import {assertSemester,validSemester} from '../../../js/semester.js';
const managers=['admin','super_admin'];
const fail=message=>{throw Object.assign(Error(message),{code:'permission-denied'});};
export const cohortCollections=new Set(['students','subjects','offerings','enrollments','marks','assignments','clearancePlans','noDueRequests','approvals','hallTickets','sectionDetails']);
const caches=new WeakMap();
const valid=value=>validSemester(value)?Number(value):null;
// Never infer a historical semester from the student's present placement.
export function semesterResolver(database){
 const records=new Map(),resolutions=new Map();
 const read=async(name,id)=>{const k=name+'/'+id;if(!records.has(k))records.set(k,database.collection(name).findOne({_id:id}));return records.get(k);};
 async function resolve(name,row,seen=new Set()){
  if(!row)return null;
  const tag=name+'/'+(row._id||row.uid||'');
  if(seen.has(tag))return null;
  seen=new Set([...seen,tag]);
  if(name==='users')return row.role==='student'?resolve('students',await read('students',row._id||row.uid),seen):undefined;
  if(!cohortCollections.has(name))return undefined;
  const direct=valid(row.semester);
  if(row.semester!=null&&!direct)return null;
  if(direct)return direct;
  let linked;
  if(name==='subjects'&&!direct){
   const offerings=await database.collection('offerings').find({subjectId:row._id}).project({semester:1}).toArray();
   const values=[...new Set(offerings.map(o=>valid(o.semester)))];
   return values.length===1&&values[0]!==null?values[0]:null;
  }
  if(['enrollments','marks','assignments'].includes(name)&&row.offeringId)linked=await resolve('offerings',await read('offerings',row.offeringId),seen);
  if(['approvals','hallTickets'].includes(name)){
   const id=row.requestId||row.__parent;
   if(id)linked=await resolve('noDueRequests',await read('noDueRequests',id),seen);
  }
  if(name==='sectionDetails'&&!direct){
   const offerings=await database.collection('offerings').find({departmentId:row.departmentId,section:row.section}).project({semester:1}).toArray();
   const students=await database.collection('students').find({departmentId:row.departmentId,section:row.section}).project({semester:1}).toArray();
   const values=[...new Set([...offerings,...students].map(o=>valid(o.semester)))];
   return values.length===1&&values[0]!==null?values[0]:null;
  }
  return linked||null;
 }
 return async(name,row)=>{const tag=name+'/'+(row?._id||'');if(row?._id){if(!resolutions.has(tag))resolutions.set(tag,resolve(name,row));return resolutions.get(tag);}return resolve(name,row);};
}
function context(database,actor){
 if(!caches.has(actor))caches.set(actor,{resolve:semesterResolver(database),ids:new Map()});
 return caches.get(actor);
}
export const managesSemester=actor=>managers.includes(actor.role)&&actor.managementSemester!=null;
export function assertInputSemester(actor,row){
 if(managesSemester(actor)&&assertSemester(row.semester)!==actor.managementSemester)fail('CSV/account semester differs from Managing Semester '+actor.managementSemester+'. Switch semester and validate again.');
}
export async function assertRecordSemester(database,actor,name,row){
 if(!managesSemester(actor))return;
 const semester=await semesterResolver(database)(name,row);
 if(semester===undefined)return;
 if(semester!==actor.managementSemester)fail(semester===null?'This record has an ambiguous historical semester. Manual review is required.':'This record belongs to another managing semester.');
}
export async function semesterMatch(database,actor,name){
 if(!managesSemester(actor)||!cohortCollections.has(name))return {};
 const c=context(database,actor);
 if(!c.ids.has(name))c.ids.set(name,(async()=>{
  const rows=await database.collection(name).find({}).project({semester:1,subjectId:1,offeringId:1,requestId:1,__parent:1,studentId:1,departmentId:1,section:1}).toArray(),ids=[];
  for(const row of rows)if(await c.resolve(name,row)===actor.managementSemester)ids.push(row._id);
  return {_id:{$in:ids}};
 })());
 return c.ids.get(name);
}
export async function semesterContext(req,res,next){
 try{
  if(!managers.includes(req.actor.role))return next();
  // Bootstrap reads may precede mounting the selector; operational requests
  // require an explicit context so an omitted header cannot target Semester 5.
  const raw=req.get('X-Semester');
  if(raw===undefined&&!['/auth/profile','/auth/password-complete','/administration/masters'].includes(req.path))throw Object.assign(Error('Select Managing Semester (1–8) before managing records.'),{code:'invalid-argument'});
  req.actor={...req.actor,managementSemester:raw===undefined?5:assertSemester(raw)};
  const db=req.departmentDatabase,body=req.body||{},path=req.path;
  if(body.row?.semester!==undefined)assertInputSemester(req.actor,body.row);
  if(req.query.semester!==undefined&&req.query.semester!=='')assertInputSemester(req.actor,{semester:req.query.semester});
  if(path==='/administration/directory'&&body.semester)assertInputSemester(req.actor,body);
  const studentIds=new Set();
  if(body.uid||body.studentUid)studentIds.add(body.uid||body.studentUid);
  for(const uid of body.accountIds||[])studentIds.add(uid);
  const studentPath=path.match(/^\/academic\/student\/([^/]+)$/);
  if(studentPath)studentIds.add(studentPath[1]);
  for(const uid of studentIds){
   const student=await db.collection('students').findOne({_id:uid});
   if(student)await assertRecordSemester(db,req.actor,'students',student);
  }
  const requestPath=path.match(/^\/(?:oversight\/)?requests\/([^/]+)/);
  if(requestPath){const record=await db.collection('noDueRequests').findOne({_id:requestPath[1]});if(record)await assertRecordSemester(db,req.actor,'noDueRequests',record);}
  next();
 }catch(error){next(error);}
}
