
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
 if(auid&&profile.auid&&upper(profile.auid)!==auid)fail('The student already has a different AUID.');
 if(departmentCode(profile.department)!==departmentCode(input.department)||departmentCode(user.department)!==departmentCode(input.department)
   ||[user.departmentId,profile.departmentId].some(id=>id&&id!==input.departmentId))fail('The matched student belongs to another department.','permission-denied');
 const currentEmail=email(user.email),pending=user.studentImportEmail;
 const acceptedAuthEmails=pending?.from===currentEmail?[currentEmail,pending.to]:[currentEmail];
 if(!account||!currentEmail||email(profile.email)!==currentEmail||!acceptedAuthEmails.includes(email(account.email)))fail('The existing Firebase and student identity need review before reconciliation.','failed-precondition');
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
