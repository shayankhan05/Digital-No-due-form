// Request-local read snapshot for CSV preflight only. Commit always revalidates
// against the live repository; no account status is cached across requests.
export async function previewStore(store,{studentReconciliation=false}={}){
 const names=['users','students','subjects','offerings','departments','schemes','institutionPolicy','uniqueIdentities','departmentWorkflows','provisioningJobs',...(studentReconciliation?['noDueRequests','enrollments','testDataRegistry','presentationIdentityJournal']:[])],snapshot=Object.fromEntries(await Promise.all(names.map(async name=>[name,await store.database.collection(name).find({}).toArray()])));
 const snap=(path,row)=>({id:path.split('/').at(-1),exists:!!row,data:()=>{if(!row)return undefined;const {_id,__parent,...data}=structuredClone(row);return data;}});
 function query(path,filters=[],max=null){return {where:(...filter)=>query(path,[...filters,filter],max),limit:n=>query(path,filters,n),get:async()=>{const name=path==='settings'?'institutionPolicy':path;const rows=(snapshot[name]||[]).filter(row=>filters.every(([field,op,value])=>{const actual=row[field==='__name__'?'_id':field];return op==='=='?actual===value:op==='in'?value.includes(actual):false;}));const docs=(max?rows.slice(0,max):rows).map(row=>snap(path+'/'+row._id,row));return{docs,size:docs.length,empty:!docs.length};}};}
 return {snapshot,database:store.database,doc:path=>({get:async()=>{const [name,id]=path.split('/');return snap(path,(snapshot[name==='settings'?'institutionPolicy':name]||[]).find(r=>r._id===id));}}),collection:path=>query(path)};
}
export async function previewAuth(auth,rows,uids=[]){
 const emails=[...new Set(rows.flatMap(r=>[r.collegeEmail,r.mentorEmail,r.teacherEmail]).filter(Boolean).map(e=>String(e).trim().toLowerCase()))],found=new Map();
 const identifiers=[...emails.map(email=>({email})),...[...new Set(uids)].map(uid=>({uid}))];
 const missingUids=new Set();
 for(let start=0;start<identifiers.length;start+=100){
  const result=await auth.getUsers(identifiers.slice(start,start+100));
  for(const u of result.users){if(u.email)found.set(u.email.toLowerCase(),u);found.set(u.uid,u);}
  for(const identifier of result.notFound||[])if(identifier.uid)missingUids.add(identifier.uid);
 }
 const missing=()=>{throw Object.assign(new Error('User not found.'),{code:'auth/user-not-found'});};
 return {getUserByEmail:async email=>found.get(email)||missing(),getUser:uid=>found.has(uid)?Promise.resolve(found.get(uid)):missingUids.has(uid)?missing():auth.getUser(uid)};
}
