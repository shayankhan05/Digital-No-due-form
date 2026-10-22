import {recordDigest} from './presentation-reset.js';
import {createHash} from 'node:crypto';
const lower=v=>String(v||'').trim().toLowerCase();
const blocked=u=>['inactive','exited','deleted','deleting','exiting','deactivating'].includes(u.accountStatus);
const generatedName=/^(?:synthetic|demo|test|load)\b.*\bstudent\b|^student\s*\d+$/i;
const generatedEmail=/^(?:(?:ise|cse)-demo-)?1ay\d+[a-z]+\d+@demo\.test$|^(?:student|synthetic|demo-student|test-student)\d+@demo\.test$/i;
const first=['Aarav','Zoya','Kabir','Riya','Aditya','Sana','Armaan','Meera','Gurpreet','Rohan','Ayesha','Neil','Simran','Reyansh','Ananya','Ishaan','Sara','Dev','Anika','Vihaan'];
const last=['Sharma','Khan','Singh',"D'Souza",'Nair','Joseph','Siddiqui','Iyer','Kaur','Verma','Rahman','Thomas','Patel','Rao','Kapoor','Menon','Qureshi','Mehta','Das','Reddy'];
// Plan only: canonical role mailboxes may be released by a verified former HOD.
// Never merge identities or infer ownership from role/name alone.
export function planFormerHodEmailRelease(snapshot,authUsers,department,current,targetEmail){
 const users=snapshot.users||[],owner=users.filter(u=>lower(u.email)===lower(targetEmail));
 if(owner.length!==1)return null;
 const former=owner[0],authOwner=authUsers.filter(u=>lower(u.email)===lower(targetEmail));
 const history=(snapshot.departmentLeadershipHistory||[]).filter(h=>h.departmentId===department._id&&h.position==='hod');
 const visited=new Set([former._id]);let changed=true;
 while(changed){changed=false;for(const h of history)if(visited.has(h.oldId)&&!visited.has(h.newId)){visited.add(h.newId);changed=true;}}
 if(former._id===current._id||former.role!=='hod'||former.departmentId!==department._id||former.accountStatus!=='inactive'||!former.hodRevokedAt||!former.facultyId||!current.facultyId||blocked(current)||authOwner.length!==1||authOwner[0].uid!==former._id||!visited.has(current._id)||!(snapshot.departmentWorkflows||[]).some(w=>w._id===department._id&&w.hodId===current._id)||department.hodId!==current._id)return null;
 if([...(snapshot.departments||[]),...(snapshot.departmentWorkflows||[])].some(d=>d.hodId===former._id))return null;
 const slug=String(former.name||'').replace(/^dr\.?\s+/i,'').normalize('NFKD').toLowerCase().replace(/[^a-z\s]/g,'').trim().replace(/\s+/g,'.');
 if(!slug)return null;
 const email=slug+'.'+department.code.toLowerCase()+'@demo.test';
 if([...users,...authUsers,...(snapshot.students||[])].some(u=>lower(u.email)===email))return null;
 const key='email_'+createHash('sha256').update(email).digest('hex'),oldKey='email_'+createHash('sha256').update(lower(targetEmail)).digest('hex');
 if((snapshot.uniqueIdentities||[]).some(r=>r._id===key)||!(snapshot.uniqueIdentities||[]).some(r=>r._id===oldKey&&r.uid===former._id))return null;
 return {uid:former._id,name:former.name,oldEmail:former.email,email,currentHodUid:current._id,departmentId:department._id,facultyId:former.facultyId,accountStatus:former.accountStatus,historyIds:history.map(h=>h._id),reason:'Inactive former HOD owns canonical mailbox; preserve both UIDs and all leadership history. Release this email before current HOD normalization.'};
}
export function planPresentationCleanup(snapshot,authUsers){
 const users=snapshot.users||[],students=snapshot.students||[],departments=snapshot.departments||[],workflows=snapshot.departmentWorkflows||[],authByUid=new Map(authUsers.map(u=>[u.uid,u])),byUid=new Map(users.map(u=>[u._id,u]));
 const used=new Map();for(const u of [...users,...authUsers]){const email=lower(u.email),uid=u._id||u.uid;if(email){if(!used.has(email))used.set(email,new Set());used.get(email).add(uid);}}
 const hodEmailReconciliations=[],identities=[],conflicts=[],officeMappings=[],excludedIncompleteProfiles=students.filter(s=>!byUid.has(s._id)&&generatedName.test(s.name||'')).map(s=>({uid:s._id,name:s.name,usn:s.usn||null,departmentId:s.departmentId||null,reason:'No complete user/email identity; no Auth identity may be inferred or created'}));
 const add=(u,name,email,kind)=>{
  const a=authByUid.get(u._id),owners=used.get(lower(email));
  if(!a||lower(a.email)!==lower(u.email)||owners&&[...owners].some(id=>id!==u._id)){conflicts.push({uid:u._id,email:u.email,kind,reason:!a?'Missing Firebase UID':lower(a.email)!==lower(u.email)?'Firebase/Mongo ownership mismatch':'Target email already owned'});return;}
  if(lower(u.email)===lower(email)&&u.name===name)return;
  used.set(lower(email),new Set([u._id]));identities.push({uid:u._id,kind,oldName:u.name,name,oldEmail:u.email,email,usn:students.find(s=>s._id===u._id)?.usn||null,departmentId:u.departmentId,role:u.role,passwordAction:'KEEP'});
 };
 for(const s of [...students].sort((a,b)=>String(a._id).localeCompare(String(b._id)))){
  const u=byUid.get(s._id),d=departments.find(d=>d._id===(s.departmentId||u?.departmentId));
  if(!u||u.role!=='student'||!['ISE','CSE'].includes(d?.code)||!lower(u.email).endsWith('@demo.test')||!generatedName.test(s.name||u.name||'')&&!generatedEmail.test(u.email))continue;
  if(s.email&&lower(s.email)!==lower(u.email)){conflicts.push({uid:u._id,email:u.email,kind:'student',reason:'Student/user emails disagree'});continue;}
  const index=createHash('sha256').update(u._id).digest().readUInt32BE(0),name=generatedName.test(s.name||u.name||'')?first[index%first.length]+' '+last[Math.floor(index/first.length)%last.length]:s.name||u.name;
  const slug=name.toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g,'').trim().replace(/\s+/g,'.'),year=String(s.usn||'').match(/1AY(\d{2})/i)?.[1]||'demo';let email=slug+'.'+d.code.toLowerCase()+year+'@demo.test';
  if(used.has(email)&&[...used.get(email)].some(id=>id!==u._id))email=slug+'.'+d.code.toLowerCase()+year+'.'+createHash('sha256').update(u._id).digest('hex').slice(0,6)+'@demo.test';
  add(u,name,email,'student');
 }
 for(const d of departments.filter(d=>['ISE','CSE','ME'].includes(d.code))){
  const wf=workflows.find(w=>w._id===d._id),hod=d.hodId||wf?.hodId;
  if(d.hodId&&wf?.hodId&&d.hodId!==wf.hodId)conflicts.push({department:d.code,kind:'hod',reason:'Department and workflow HOD disagree'});
  else if(hod){const u=byUid.get(hod);if(u?.role==='hod'&&u.departmentId===d._id&&lower(u.email).endsWith('@demo.test')){
   const target='hod.'+d.code.toLowerCase()+'@demo.test',owners=used.get(target),a=authByUid.get(u._id);
   let release=null;
   if(owners&&[...owners].some(id=>id!==u._id)&&a&&lower(a.email)===lower(u.email))release=planFormerHodEmailRelease(snapshot,authUsers,d,u,target);
   if(release){
    const former=byUid.get(release.uid),before=identities.length;add(former,former.name,release.email,'hod');
    if(identities.length>before){identities.at(-1).purpose='RELEASE_FORMER_HOD_EMAIL';used.get(target).delete(former._id);hodEmailReconciliations.push(release);}else release=null;
   }
   const before=identities.length;add(u,u.name,target,'hod');
   if(release&&identities.length>before)identities.at(-1).dependsOnUid=release.uid;
  }else conflicts.push({department:d.code,kind:'hod',reason:'Current HOD is not a uniquely verified department demo identity'});}
  const valid=u=>u?.role==='office'&&u.scope==='department'&&u.departmentId===d._id&&!blocked(u);
  const mapped=byUid.get(wf?.officeId),candidates=users.filter(valid);let office=valid(mapped)?mapped:null;
  if(!office&&wf?.officeId)conflicts.push({department:d.code,kind:'office-mapping',reason:'Existing non-empty Office mapping is invalid; never overwrite automatically'});
  else if(!office&&candidates.length===1){office=candidates[0];officeMappings.push({departmentId:d._id,department:d.code,officeId:office._id,oldOfficeId:null,action:'ASSIGN_EXISTING'});}
  else if(!office)conflicts.push({department:d.code,kind:'office-mapping',reason:'No unique eligible existing department Office'});
  if(office&&lower(office.email).endsWith('@demo.test'))add(office,office.name,'office.'+d.code.toLowerCase()+'@demo.test','office');
 }
 const resetRequests=[];
 for(const r of snapshot.noDueRequests||[]){const u=byUid.get(r.studentId),s=students.find(s=>s._id===r.studentId);if(u?.role!=='student'||!s||!lower(u.email).endsWith('@demo.test'))continue;
  resetRequests.push({requestId:r._id,studentId:u._id,name:s.name||u.name,usn:s.usn,email:u.email,status:r.status,departmentId:s.departmentId,approvalIds:(snapshot.approvals||[]).filter(a=>a.requestId===r._id||a.__parent===r._id||String(a._id).startsWith(r._id+'/')).map(a=>a._id),notificationIds:(snapshot.notifications||[]).filter(n=>n.requestId===r._id).map(n=>n._id),hallTicketIds:(snapshot.hallTickets||[]).filter(h=>h.requestId===r._id||h._id===r._id).map(h=>h._id),overrideIds:(snapshot.workflowOverrides||[]).filter(o=>o.requestId===r._id).map(o=>o._id)});
 }
 for(const r of resetRequests){
 const request=snapshot.noDueRequests.find(row=>row._id===r.requestId);r.requestDigest=recordDigest(request);r.relatedIds={approvals:r.approvalIds,notifications:r.notificationIds,hallTickets:r.hallTicketIds,workflowOverrides:r.overrideIds};r.relatedDigests=Object.fromEntries(Object.entries(r.relatedIds).map(([collection,ids])=>[collection,recordDigest((snapshot[collection]||[]).filter(row=>ids.includes(row._id)).sort((a,b)=>String(a._id).localeCompare(String(b._id))))]));
 }
 return {version:1,mode:'DRY_RUN_ONLY',hodEmailReconciliations,identities,officeMappings,resetRequests,passwordResets:[],conflicts,excludedIncompleteProfiles,counts:{studentIdentities:identities.filter(i=>i.kind==='student').length,hodEmails:identities.filter(i=>i.kind==='hod'&&!i.purpose).length,formerHodEmailReleases:hodEmailReconciliations.length,officeEmails:identities.filter(i=>i.kind==='office').length,officeMappings:officeMappings.length,resetRequests:resetRequests.length,passwordResets:0}};
}
