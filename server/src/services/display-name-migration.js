import {createHash} from 'node:crypto';
import {officeSearchDocument} from './office-search.js';
export const syntheticName=/^Synthetic ISE Student\s+(\d+)$/i;
const first=['Aarav','Ayesha','Vihaan','Meher','Aditya','Inaya','Arjun','Sara','Devansh','Hiba','Karan','Anaya','Rohan','Zoya','Ishaan','Diya','Kabir','Anika','Reyansh','Nisha','Dhruv','Sana','Yash','Kavya','Atharv','Priya','Neel','Riya','Vedant','Isha','Siddharth','Mira'];
const last=['Sharma','Khan','Kapoor','Fatima','Nair','Rahman','Malhotra','Qureshi','Rao','Noor','Bhat','Deshmukh','Verma','Siddiqui','Patel','Menon','Joshi','Kulkarni','Shetty','Reddy','Gupta','Iyer','Das','Chatterjee','Saxena','Bose','Mehta','Pillai','Singh','Hegde','Shah','Bansal'];
const displayFields=new Set(['name','studentName','displayName','fullName','actorName','issuedBy','actedBy']);
export function planDisplayNames(snapshot){
 const identities=new Map();
 for(const table of ['users','students'])for(const row of snapshot[table]||[])if(syntheticName.test(row.name||'')){const previous=identities.get(row._id);if(previous&&previous.oldName!==row.name)throw new Error('Conflicting synthetic profile names.');identities.set(row._id,{uid:row._id,oldName:row.name});}
 for(const identity of identities.values())for(const table of ['users','students']){const row=(snapshot[table]||[]).find(r=>r._id===identity.uid);if(row?.name&&!syntheticName.test(row.name))throw new Error('A synthetic profile conflicts with a normal name; review that identity before migration.');}
 const used=new Set(['users','students'].flatMap(c=>(snapshot[c]||[]).filter(r=>!syntheticName.test(r.name||'')).map(r=>String(r.name||'').toLowerCase())));
 for(const identity of [...identities.values()].sort((a,b)=>String(a.uid).localeCompare(String(b.uid)))){
  const index=Number(identity.oldName.match(syntheticName)[1])-1,offset=createHash('sha256').update(String(identity.uid)).digest().readUInt16BE(0);let name;
  for(let attempt=0;attempt<first.length*last.length;attempt++){name=`${first[(index+attempt)%first.length]} ${last[(offset+Math.floor(attempt/first.length))%last.length]}`;if(!used.has(name.toLowerCase()))break;name=null;}
  if(!name)throw new Error('No unique deterministic display name available.');identity.name=name;used.add(name.toLowerCase());
 }
 const byName=new Map();for(const identity of identities.values()){if(byName.has(identity.oldName)&&byName.get(identity.oldName)!==identity.name)throw new Error('Ambiguous copied synthetic name; resolve identities before migration.');byName.set(identity.oldName,identity.name);}
 const changes=[];
 function visit(value,path,fields){if(!value||typeof value!=='object'||value instanceof Date)return;for(const [key,item]of Object.entries(value)){const next=path?`${path}.${key}`:key;if(displayFields.has(key)&&typeof item==='string'&&byName.has(item))fields[next]=byName.get(item);else if(item&&typeof item==='object')visit(item,next,fields);}}
 for(const [collection,rows]of Object.entries(snapshot))for(const row of rows){const fields={};visit(row,'',fields);if(collection==='officeStudentSearch'&&identities.has(row._id)){const student=(snapshot.students||[]).find(s=>s._id===row._id);if(student){const index=officeSearchDocument(row._id,{...student,name:identities.get(row._id).name});fields.nameKey=index.nameKey;fields.searchKeys=index.searchKeys;}}if(Object.keys(fields).length)changes.push({collection,id:row._id,fields});}
 return {identities:[...identities.values()],changes};
}
export async function migrateDisplayNames(database,client,{apply=false,beforeApply=async()=>{}}={}){
 const snapshot={};for(const c of await database.listCollections().toArray())snapshot[c.name]=await database.collection(c.name).find({}).toArray();
 const plan=planDisplayNames(snapshot),counts=Object.fromEntries(Object.entries(snapshot).map(([k,rows])=>[k,rows.length]));
 if(apply){await beforeApply(snapshot,plan);const session=client.startSession();try{await session.withTransaction(async()=>{for(const change of plan.changes){const original=snapshot[change.collection].find(row=>row._id===change.id),filter={_id:change.id};for(const field of Object.keys(change.fields)){let value=original;for(const part of field.split('.'))value=value[part];filter[field]=value;}const result=await database.collection(change.collection).updateOne(filter,{$set:change.fields},{session});if(result.matchedCount!==1)throw new Error('Display data changed during migration; retry from a fresh backup.');}});}finally{await session.endSession();}}
 return {counts,...plan};
}
