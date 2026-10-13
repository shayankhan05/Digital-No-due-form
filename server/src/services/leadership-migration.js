import {isDeepStrictEqual} from 'node:util';
import {departmentOf} from './department-master.js';

// Additive, explicit operator migration. Identity and academic/history fields
// are never rewritten. Ambiguous leadership is reported, never guessed.
export async function migrateDepartmentLeadership(database,client,{apply=false}={}){
 const departments=await database.collection('departments').find({}).toArray(),users=await database.collection('users').find({}).toArray(),schemes=await database.collection('schemes').find({status:'active'}).toArray(),policy=await database.collection('institutionPolicy').findOne({_id:'institution'});
 const changes=[],conflicts=[];
 for(const u of users.filter(u=>u.role==='admin')){
  const id=await departmentOf(database,'users',{...u,scope:'department'});
  if(!id){conflicts.push({uid:u._id,reason:'Admin department cannot be uniquely resolved'});continue;}
  const fields={scope:'department',departmentId:id};if(Object.entries(fields).some(([k,v])=>!isDeepStrictEqual(u[k],v)))changes.push({collection:'users',id:u._id,fields});
 }
 for(const d of departments){
  const fields={},eligible=[];for(const u of users.filter(u=>u.role==='admin'&&!['inactive','deleted','deactivating'].includes(u.accountStatus)))if(await departmentOf(database,'users',{...u,scope:'department'})===d._id)eligible.push(u);
  const selected=d.adminId&&eligible.find(u=>u._id===d.adminId)||eligible.length===1&&eligible[0];
  if(selected){fields.adminId=selected._id;fields.departmentAdminId=selected._id;}else if(eligible.length!==1)conflicts.push({departmentId:d._id,reason:'Department Admin is absent or ambiguous',candidates:eligible.map(u=>u._id)});
  const workflow=await database.collection('departmentWorkflows').findOne({_id:d._id}),hod=users.find(u=>u._id===(d.hodId||workflow?.hodId));
  if(hod&&hod.role==='hod'&&!['inactive','deleted','deactivating'].includes(hod.accountStatus)&&await departmentOf(database,'users',{...hod,scope:'department'})===d._id)fields.hodId=hod._id;else conflicts.push({departmentId:d._id,reason:'HOD assignment requires review'});
  if(!d.schemeIds?.length)fields.schemeIds=schemes.filter(s=>s.scope==='institution'||s.departmentIds?.includes(d._id)).map(s=>s._id);
  if(!d.sections?.length)fields.sections=policy?.sections?.length?policy.sections:['A','B','C'];
  const delta=Object.fromEntries(Object.entries(fields).filter(([k,v])=>!isDeepStrictEqual(d[k],v)));if(Object.keys(delta).length)changes.push({collection:'departments',id:d._id,fields:delta});
 }
 if(apply){const session=client.startSession();try{await session.withTransaction(async()=>{for(const c of changes)await database.collection(c.collection).updateOne({_id:c.id},{$set:c.fields},{session});});}finally{await session.endSession();}}
 return {apply,changes,conflicts};
}
