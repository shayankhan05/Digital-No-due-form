// Derived search documents only; no student, marks or workflow writes.
import {isDeepStrictEqual} from 'node:util';
export const normalizeSearch=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
const department=value=>['ise','information science & engineering','information science and engineering'].includes(normalizeSearch(value))?'ise':normalizeSearch(value);
export function officeSearchDocument(uid,student){
  const name=normalizeSearch(student.name).slice(0,200),keys=new Set();
  for(let length=1;length<=3;length++)for(let i=0;i<=name.length-length;i++)keys.add(name.slice(i,i+length));
  return {uid,name:String(student.name||''),usn:String(student.usn||''),email:String(student.email||''),department:String(student.department||''),semester:student.semester??null,section:String(student.section||''),nameKey:name,emailKey:normalizeSearch(student.email),usnKey:normalizeSearch(student.usn),searchKeys:[...keys].sort()};
}
export async function syncOfficeSearchIndex(db,uid){
  // Re-read the current profile so a delayed event cannot restore an older name.
  const ref=db.doc(`officeStudentSearch/${uid}`);
  await db.runTransaction(async transaction=>{
    const [student,index]=await Promise.all([transaction.get(db.doc(`students/${uid}`)),transaction.get(ref)]);
    if(!student.exists){if(index.exists)transaction.delete(ref);return;}
    const next=officeSearchDocument(uid,student.data());
    if(!index.exists||!isDeepStrictEqual(index.data(),next))transaction.set(ref,next);
  });
}
export function officeStatus(request){
  if(!request)return {noDue:'No request',hallTicket:'Not issued'};
  const labels={pending_mentor:'Pending Mentor',pending_hod:'Pending HOD',cleared:'Pending Office · Cleared',issued:'Cleared',rejected:'Rejected'};
  const pending=Object.entries(request.approvalItems||{}).filter(([key])=>request.approvalStates?.[key]==='pending').map(([,item])=>item.approverType);
  const stage=pending.length===1&&pending[0]==='accounts'?'Pending Accounts':pending.length===1&&pending[0]==='library'?'Pending Library':'Pending Stage 1';
  return {noDue:request.status==='pending_stage1'?stage:labels[request.status]||request.status||'Unknown',hallTicket:request.status==='issued'?'Issued':'Not issued'};
}
export async function searchOfficeStudents(db,uid,input={}){
  const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
  if(!uid)fail('unauthenticated','Sign in first.');
  if((await db.doc(`users/${uid}`).get()).data()?.role!=='office')fail('permission-denied','Only Office may search students.');
  const term=normalizeSearch(input.term);if(!term||term.length>200)fail('invalid-argument','Enter a name, USN, student ID or college email (up to 200 characters).');
  const filters=input.filters||{};for(const key of ['department','semester','section','usn','email'])if(String(filters[key]??'').length>200)fail('invalid-argument','Filter is too long.');
  const cursor=input.cursor||null;if(cursor&&!/^[A-Za-z0-9_-]{1,128}$/.test(cursor))fail('invalid-argument','Invalid search cursor.');
  const index=db.collection('officeStudentSearch');let docs=[],more=false,nextCursor=null,mode='name';
  const direct=/^[A-Za-z0-9_-]{1,128}$/.test(String(input.term).trim())&&!cursor?await index.doc(String(input.term).trim()).get():null;
  if(direct?.exists){docs=[direct];mode='student ID';}
  else{
    mode=term.includes('@')?'email':/^\d[a-z0-9-]+$/.test(term)?'USN':'name';
    let query=mode==='email'?index.where('emailKey','==',term):mode==='USN'?index.where('usnKey','==',term):index.where('searchKeys','array-contains',term.slice(0,Math.min(3,term.length)));
    query=query.orderBy('__name__').limit(50);if(cursor)query=query.startAfter(index.doc(cursor));
    docs=(await query.get()).docs;more=docs.length===50;nextCursor=more?docs.at(-1).id:null;
  }
  const matches=docs.filter(doc=>{
    const row=doc.data();return (mode!=='name'||row.nameKey.includes(term))
      && (!filters.department||department(row.department)===department(filters.department))
      && (!filters.semester||String(row.semester)===String(filters.semester).trim())
      && (!filters.section||normalizeSearch(row.section)===normalizeSearch(filters.section))
      && (!filters.usn||row.usnKey.includes(normalizeSearch(filters.usn)))
      && (!filters.email||row.emailKey.includes(normalizeSearch(filters.email)));
  });
  const rows=await Promise.all(matches.map(async doc=>{
    const {nameKey,emailKey,usnKey,searchKeys,...student}=doc.data();
    const requests=await db.collection('noDueRequests').where('studentId','==',doc.id).where('officeId','==',uid).orderBy('createdAt','desc').limit(1).get();
    const latest=requests.docs[0],request=latest?{id:latest.id,...latest.data()}:null;
    return {...student,status:officeStatus(request),request:request?{id:request.id,status:request.status,studentName:request.studentName,usn:request.usn,semester:request.semester,section:request.section,approvalItems:request.approvalItems||{},approvalStates:request.approvalStates||{},mentorApproval:request.mentorApproval||{},hodApproval:request.hodApproval||{}}:null};
  }));
  return {rows,count:rows.length,more,nextCursor,mode,scanned:docs.length};
}
