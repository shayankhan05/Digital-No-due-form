
import {recordDigest} from './presentation-reset.js';
import {createHash} from 'node:crypto';
import {departmentCode} from '../../../js/department.js';
import {isInactive} from './account-removal.js';

const text=value=>String(value??'').trim();
const email=value=>text(value).toLowerCase();
const upper=value=>text(value).toUpperCase();
const fail=(message,code='already-exists')=>{throw Object.assign(Error(message),{code});};
const lookup=async fn=>{try{return await fn();}catch(error){if(error.code==='auth/user-not-found')return null;throw error;}};
const collation={locale:'en',strength:2};
export const studentIdentityKey=(kind,value)=>kind+'_'+createHash('sha256').update(value).digest('hex');
export const activeStudentRequests=['pending_stage1','pending_mentor','pending_hod','pending_office','cleared','rejected'];

async function find(store,collection,criteria){
 if(store.snapshot){
  return (store.snapshot[collection]||[]).filter(row=>criteria.some(([field,value])=>typeof value==='string'&&field!=='_id'?email(row[field])===email(value):row[field]===value));
 }
 return store.database.collection(collection).find({$or:criteria.map(([field,value])=>({[field]:value}))},{session:store.session,collation}).toArray();
}


export const studentNameKey=value=>text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
export async function verifiedDemoStudent(store,uid,profile,user){
 if([profile,user].some(r=>['production','historical-production'].includes(r?.dataOrigin)))return false;
 const registry=store.snapshot?store.snapshot.testDataRegistry||[]:await store.database.collection('testDataRegistry').find({recordId:uid,origin:'test'},{session:store.session}).toArray();
 return [['students',profile],['users',user]].every(([collection,row])=>registry.some(r=>r.collection===collection&&r.recordId===uid&&r.origin==='test'&&text(r.evidence)&&r.digest===recordDigest({_id:uid,...row})));
}
export async function studentIdentityReview(store,uid,profile,user,account,input){
 const demo=await verifiedDemoStudent(store,uid,profile,user),protectedReal=[profile,user].some(r=>['production','historical-production'].includes(r?.dataOrigin));
 const fields=r=>({name:r.name,usn:r.usn,auid:r.auid||'',email:r.email||r.collegeEmail,phone:r.phone,section:r.section,semester:r.semester,scheme:r.scheme,mentorId:r.mentorId||null,mentorEmployeeId:r.mentorEmployeeId||null});
 const mappings=store.snapshot?(store.snapshot.enrollments||[]).filter(r=>r.studentId===uid&&r.active!==false):await store.database.collection('enrollments').find({studentId:uid,active:{$ne:false}},{session:store.session,projection:{offeringId:1,teacherId:1,mentorId:1}}).toArray();
 const mentor=profile.mentorId?(await store.doc('users/'+profile.mentorId).get()).data():null;
 return {uid,classification:demo?'DEMO_REPLACEMENT':protectedReal?'CONFLICT':'AMBIGUOUS',eligibleForReplacement:demo,reason:demo?'Both identity records have current, explicit test provenance. Separate Firebase identity required.':protectedReal?'This is a protected real student identity. Incoming details describe a different person; replacement is blocked.':'USN matches but the names do not establish the same person. Manual identity review required.',existing:fields({...user,...profile,mentorEmployeeId:mentor?.facultyId||''}),incoming:fields(input),firebase:{exists:!!account,disabled:account?.disabled??null,uid:account?.uid||null},mappings};
}

export async function resolveStudentImport(store,auth,input,{keepPlacement=false}={}){
 const usn=upper(input.usn),auid=upper(input.auid),incoming=email(input.collegeEmail),providedUid=text(input.uid);
 if(providedUid&&!/^[A-Za-z0-9_-]{1,128}$/.test(providedUid))fail('Invalid student UID.','invalid-argument');
 const keys=[studentIdentityKey('email',incoming),studentIdentityKey('usn',usn),studentIdentityKey('loginId',usn),...(auid?[studentIdentityKey('auid',auid)]:[])];
 const [profiles,accounts,reservations,incomingAuth]=await Promise.all([
  find(store,'students',[['usn',usn],['email',incoming],...(auid?[['auid',auid]]:[]),...(providedUid?[['_id',providedUid]]:[])]),
  find(store,'users',[['email',incoming],['facultyId',usn],...(providedUid?[['_id',providedUid]]:[])]),
  find(store,'uniqueIdentities',keys.map(key=>['_id',key])),
  lookup(()=>auth.getUserByEmail(incoming)),
 ]);
 const candidates=new Set([...profiles.map(r=>r._id),...accounts.map(r=>r._id),...reservations.map(r=>r.uid),incomingAuth?.uid].filter(Boolean));
 if(candidates.size>1)fail('USN, AUID, email or UID identify different institutional accounts.');
 const [uid]=candidates;
 if(!uid){
  if(providedUid)fail('The supplied UID does not identify an existing student.');
  return {input,uid:null,warnings:[]};
 }
 if(providedUid&&uid!==providedUid)fail('The supplied UID belongs to a different identity.');
 const [profile,user,account]=await Promise.all([
  store.doc('students/'+uid).get().then(s=>s.data()),
  store.doc('users/'+uid).get().then(s=>s.data()),
  lookup(()=>auth.getUser(uid)),
 ]);
 if(user?.role!=='student'||!profile||upper(profile.usn)!==usn||profile.uid&&profile.uid!==uid||user.firebaseUid&&user.firebaseUid!==uid)fail('The matched account does not own this student USN.');

 if(departmentCode(profile.department)!==departmentCode(input.department)||departmentCode(user.department)!==departmentCode(input.department)
   ||[user.departmentId,profile.departmentId].some(id=>id&&id!==input.departmentId))fail('The matched student belongs to another department.','permission-denied');
 const currentEmail=email(user.email),pending=user.studentImportEmail;
 const acceptedAuthEmails=pending?.from===currentEmail?[currentEmail,pending.to]:[currentEmail];
 if(!account||!currentEmail||email(profile.email)!==currentEmail||!acceptedAuthEmails.includes(email(account.email)))fail('The existing Firebase and student identity need review before reconciliation.','failed-precondition');

 const priorJobs=store.snapshot?(store.snapshot.provisioningJobs||[]).filter(r=>r._id===uid||r.result?.uid===uid):await store.database.collection('provisioningJobs').find({$or:[{_id:uid},{'result.uid':uid}]},{session:store.session}).toArray();
 const priorNames=priorJobs.filter(r=>r.state==='complete'&&r.result?.name&&studentNameKey(r.result.name)!==studentNameKey(input.name)&&(!r.result.auid||upper(r.result.auid)!==auid)).map(r=>r.result.name);
 const journal=store.snapshot?(store.snapshot.presentationIdentityJournal||[]).find(r=>r.uid===uid):await store.database.collection('presentationIdentityJournal').findOne({uid},{session:store.session});
 if(journal?.backupReference&&journal.state==='complete'&&studentNameKey(journal.name)!==studentNameKey(input.name)&&!priorNames.includes(journal.name))priorNames.push(journal.name);
 if(priorNames.length&&studentNameKey(profile.name)===studentNameKey(input.name)&&!await verifiedDemoStudent(store,uid,profile,user)){
  const review=await studentIdentityReview(store,uid,profile,user,account,input);
  Object.assign(review,{classification:'AMBIGUOUS',eligibleForReplacement:false,priorNames,reason:'An earlier import renamed a different institutional identity without creating a separate Firebase account. Review the archived provenance before further reconciliation.'});
  throw Object.assign(Error(review.reason),{code:'already-exists',identityReview:review});
 }

 if(await verifiedDemoStudent(store,uid,profile,user)||studentNameKey(profile.name)!==studentNameKey(input.name)){
  const review=await studentIdentityReview(store,uid,profile,user,account,input);
  throw Object.assign(Error(review.reason),{code:'already-exists',identityReview:review});
 }
 if(auid&&profile.auid&&upper(profile.auid)!==auid)fail('The student already has a different AUID.');
 const inactive=isInactive(user)||isInactive(profile)||account.disabled;
 if(inactive&&(user.accountStatus!=='inactive'||profile.accountStatus!=='inactive'||user.exitOperation&&user.exitOperation!=='reactivating'))fail('The account is exited, in transition, or has inconsistent access status. Review it before import.','failed-precondition');
 const warnings=[];
 const generated=incoming.endsWith('@demo.test');
 const effective={...input,auid:profile.auid||input.auid};
 if(generated&&currentEmail!==incoming){
  effective.collegeEmail=currentEmail;
  warnings.push('Existing email retained because the CSV email is generated.');
 }
 if(generated&&(profile.phone||user.phone)){
  effective.phone=profile.phone||user.phone;
  if(effective.phone!==input.phone)warnings.push('Existing phone retained because the CSV contact is generated.');
 }
 if(keepPlacement){
  if(profile.section&&upper(profile.section)!==upper(input.section))warnings.push('Existing section retained because CSV placement is generated.');
  effective.section=profile.section||input.section;
  effective.scheme=profile.scheme||input.scheme;
 }
 if(pending&&(pending.from!==currentEmail||pending.to!==email(effective.collegeEmail)))fail('An earlier email change is unfinished. Resume that reconciliation first.','failed-precondition');
 const requests=store.snapshot?store.snapshot.noDueRequests||[]:await store.database.collection('noDueRequests').find({studentId:uid,status:{$in:activeStudentRequests}},{session:store.session}).toArray();
 const open=requests.some(r=>r.studentId===uid&&activeStudentRequests.includes(r.status));
 return {input:effective,uid,user,profile,account,inactive,open,warnings};
}
