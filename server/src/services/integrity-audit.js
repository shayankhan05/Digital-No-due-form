import {createHash} from 'node:crypto';
import {isMentor} from '../../../js/capabilities.js';
import {departmentCode} from '../../../js/department.js';
import {matchesStudent} from './clearance.js';
const normalized=value=>String(value||'').trim().toUpperCase(),email=value=>String(value||'').trim().toLowerCase();
export async function integritySnapshot(database){const names=['users','students','departments','offerings','subjects','enrollments','marks','noDueRequests','uniqueIdentities'];return Object.fromEntries(await Promise.all(names.map(async n=>[n,await database.collection(n).find({}).toArray()])));}
export function auditIntegrity(snapshot,{departmentId=null}={}){
 const byId=name=>new Map((snapshot[name]||[]).map(r=>[r._id,r])),users=byId('users'),students=byId('students'),offerings=byId('offerings'),departments=byId('departments'),reserved=new Set((snapshot.uniqueIdentities||[]).map(r=>r.uid)),issues=[],legacy=[];const scoped=r=>!departmentId||r.departmentId===departmentId||departmentCode(r.department)===departments.get(departmentId)?.code;
 for(const s of students.values())if(scoped(s)){if(!users.has(s._id)){const documentedStub=!s.email&&/^(?:load-student-|legacy-|s\d+$)/.test(s._id);(documentedStub?legacy:issues).push({type:documentedStub?'LEGACY_PROFILE_ONLY':'STUDENT_WITHOUT_USER',id:s._id});continue;}if(!s.departmentId||!departments.has(s.departmentId)){const fixture=/^(?:s[0-9]+|rosterA|rosterB|rosterLater)$/.test(s._id)&&/^USN/i.test(s.usn||'');(fixture?legacy:issues).push({type:fixture?'LEGACY_FIXTURE_MISSING_DEPARTMENT':'MISSING_DEPARTMENT',id:s._id});}const mentor=users.get(s.mentorId);if(!mentor||!isMentor(mentor)||mentor.departmentId&&s.departmentId&&mentor.departmentId!==s.departmentId)issues.push({type:'INVALID_MENTOR',id:s._id});}
 for(const u of users.values())if(scoped(u)){
  if(u.role==='student'&&!students.has(u._id)){const fixture=u.name==='student'&&/^login-student-\d+@test\.com$/.test(u.email||'');(fixture?legacy:issues).push({type:fixture?'LEGACY_USER_ONLY':'USER_WITHOUT_STUDENT',id:u._id});}
  if(!reserved.has(u._id))issues.push({type:'MISSING_IDENTITY_RESERVATION',id:u._id});
 }
 for(const o of offerings.values())if(scoped(o)&&!users.has(o.teacherId))issues.push({type:'OFFERING_WITHOUT_FACULTY',id:o._id});
 for(const e of snapshot.enrollments||[]){const s=students.get(e.studentId),o=offerings.get(e.offeringId);if(!departmentId||s&&scoped(s)){if(!s||!o)issues.push({type:'ENROLLMENT_MISSING_REFERENCE',id:e._id});else if(e.active===true&&(!matchesStudent(s,o)||e.teacherId!==o.teacherId)){const fixture=!users.has(s._id)&&/^load-student-/.test(s._id);(fixture?legacy:issues).push({type:fixture?'LEGACY_ORPHAN_ENROLLMENT':'INVALID_ACTIVE_ENROLLMENT',id:e._id});}}}
 for(const m of snapshot.marks||[])if(!departmentId||students.has(m.studentId)&&scoped(students.get(m.studentId)))if(!students.has(m.studentId)||!offerings.has(m.offeringId))issues.push({type:'MARKS_MISSING_REFERENCE',id:m._id});
 for(const r of snapshot.noDueRequests||[])if(!departmentId||students.has(r.studentId)&&scoped(students.get(r.studentId)))if(!students.has(r.studentId))issues.push({type:'REQUEST_MISSING_STUDENT',id:r._id});
 for(const [name,field,normalize]of [['users','email',email],['users','facultyId',normalized],['students','usn',normalized]]){const seen=new Map();for(const r of snapshot[name]||[]){const key=normalize(r[field]);if(!key)continue;if(seen.has(key)){if(scoped(r)||scoped(seen.get(key)))issues.push({type:'DUPLICATE_'+field.toUpperCase(),id:r._id,other:seen.get(key)._id});}else seen.set(key,r);}}
 return{issues,explainedLegacy:legacy,unexplained:issues.length,counts:Object.fromEntries(Object.entries(snapshot).map(([c,r])=>[c,r.length]))};
}
// Additive operator plan only. Conflicting identifiers are never guessed or moved.
export function identityReservationPlan(snapshot){
 const identities=new Map((snapshot.uniqueIdentities||[]).map(r=>[r._id,r])),students=new Map((snapshot.students||[]).map(s=>[s._id,s])),claims=new Map(),conflicts=[];
 for(const user of snapshot.users||[]){const id=user.role==='student'?students.get(user._id)?.usn:user.facultyId,fields=[['email',email(user.email)],...(id?[[user.role==='student'?'usn':'facultyId',normalized(id)],['loginId',normalized(id)]]:[])];for(const[kind,value]of fields){if(!value)continue;const key=kind+'_'+createHash('sha256').update(value).digest('hex');if(claims.has(key)&&claims.get(key).uid!==user._id||identities.has(key)&&identities.get(key).uid!==user._id)conflicts.push({identifierKind:kind,uid:user._id});else claims.set(key,{_id:key,uid:user._id,createdAt:new Date()});}}
 if(conflicts.length)return{additions:[],conflicts};return{additions:[...claims.values()].filter(c=>!identities.has(c._id)),conflicts:[]};
}
