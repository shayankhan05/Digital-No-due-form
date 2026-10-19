import {createHash} from 'node:crypto';
import {isInactive} from './account-removal.js';
// Narrow, restartable migration: no academic collections or historical requests are written.
export function planRoleScopes({users,departments,workflows,policy={}}){
 const active=users.filter(u=>!isInactive(u));const ids=[...new Set([policy?.accounts,...workflows.map(w=>w.accounts)].filter(Boolean))];
 const accounts=ids.length===1?active.find(u=>u._id===ids[0]&&u.role==='accounts'):null;
 if(!accounts)throw Error('Canonical Accounts identity is missing or ambiguous; no migration permitted.');
 const plans=departments.filter(d=>['ISE','CSE','ME'].includes(d.code)&&d.status==='active').map(d=>{
  const email='office.'+d.code.toLowerCase()+'@demo.test',specific=active.filter(u=>u.role==='office'&&u.scope==='department'&&u.departmentId===d._id);
  const sameEmail=users.filter(u=>String(u.email).toLowerCase()===email);
  if(specific.length>1||sameEmail.length>1)throw Error('Department Office identity is ambiguous: '+d.code);
  const existing=specific[0]||sameEmail[0];if(existing&&(isInactive(existing)||existing.role!=='office'||existing.departmentId!==d._id||existing.scope!=='department'))throw Error('Office identity requires explicit review: '+email);
  const old=workflows.find(w=>w._id===d._id);
  return {departmentId:d._id,code:d.code,name:d.name,email:existing?.email||email,uid:existing?._id||null,action:existing?'KEEP':'CREATE',previousOfficeId:old?.officeId||null,workflowExists:!!old};
 });
 return {accounts:{uid:accounts._id,email:accounts.email,previousDepartment:accounts.department||null,previousDepartmentId:accounts.departmentId||null,changed:accounts.scope!=='institution'||accounts.departmentId!=null||!!accounts.department||accounts.name!=='Accounts Department'},offices:plans};
}
export async function migrateRoleScopes({database,client,auth,provisioner,actor,apply=false}){
 const [users,departments,workflows,policy]=await Promise.all(['users','departments','departmentWorkflows'].map(n=>database.collection(n).find({}).toArray()).concat(database.collection('institutionPolicy').findOne({_id:'workflow'})));
 const plan=planRoleScopes({users,departments,workflows,policy});
 const accountIdentity=await auth.getUser(plan.accounts.uid);if(accountIdentity.email?.toLowerCase()!==plan.accounts.email.toLowerCase()||accountIdentity.disabled)throw Error('Canonical Accounts Firebase identity requires review.');
 for(const office of plan.offices){try{const identity=await auth.getUserByEmail(office.email);if(identity.disabled)throw Error('Existing Office Firebase identity is disabled: '+office.email);if(!office.uid){const expected='p_'+createHash('sha256').update(actor.uid+':department-office-scope-v1-'+office.code).digest('hex').slice(0,48),job=await database.collection('provisioningJobs').findOne({_id:expected});if(identity.uid!==expected||job?.caller!==actor.uid||job?.email!==office.email||job?.role!=='office')throw Error('Firebase Office identity conflicts: '+office.email);office.action='RESUME';}else if(identity.uid!==office.uid)throw Error('Firebase Office identity conflicts: '+office.email);}catch(error){if(error.code!=='auth/user-not-found')throw error;if(office.uid)throw Error('Existing Office is missing its Firebase identity: '+office.email);}}
 if(!apply)return plan;
 const manager=users.find(u=>u._id===actor.uid);if(manager?.role!=='super_admin'||isInactive(manager))throw Error('Active Super Admin operator required.');
 for(const office of plan.offices)if(!office.uid){const result=await provisioner.dispatch(actor.uid,{action:'provision',row:{name:office.name+' Office',collegeEmail:office.email,facultyId:'OFFICE-'+office.code,role:'office',scope:'department',department:office.code,departmentId:office.departmentId,accountType:'demo'},requestId:'department-office-scope-v1-'+office.code});office.uid=result.uid;}
 const session=client.startSession();try{await session.withTransaction(async()=>{
  if(plan.accounts.changed)await database.collection('users').updateOne({_id:plan.accounts.uid,role:'accounts'},{$set:{name:'Accounts Department',scope:'institution',departmentId:null},$unset:{department:''}},{session});
  for(const office of plan.offices){const previous=await database.collection('departmentWorkflows').findOne({_id:office.departmentId},{session});if(previous?.officeId===office.uid)continue;
   await database.collection('departmentWorkflows').updateOne({_id:office.departmentId},{$set:{departmentId:office.departmentId,officeId:office.uid,officeScopeVersion:2,updatedAt:new Date()}},{session,upsert:true});
   await database.collection('superAdminAudit').updateOne({_id:'office-scope-v1-'+office.departmentId},{$setOnInsert:{action:'WORKFLOW_OFFICE_CHANGED',actorUid:actor.uid,target:office.uid,departmentId:office.departmentId,oldId:previous?.officeId||null,newId:office.uid,reason:'Separate future department Office routing; historical requests unchanged.',operationType:'department-office-scope-migration',timestamp:new Date()}},{session,upsert:true});
  }
 });}finally{await session.endSession();}
 return plan;
}
