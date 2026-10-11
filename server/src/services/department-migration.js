import {isDeepStrictEqual} from 'node:util';
import {normalizeDepartmentFields} from '../../../js/department.js';

// Explicit opt-in for this demo's old branch label. CSE remains a separate department.
export const demoDepartmentAliases={'computer science':'ISE'};
export async function migrateDemoDepartment(database,client,{apply=false}={}){
 const report={apply,records:[],fields:0,policyChanged:false};
 const session=client.startSession();
 try{await session.withTransaction(async()=>{
  report.records=[];report.fields=0;
  for(const {name} of await database.listCollections().toArray()){
   if(name.startsWith('system.'))continue;
   for(const row of await database.collection(name).find({},{session}).toArray()){
    const next=normalizeDepartmentFields(row,demoDepartmentAliases);
    if(isDeepStrictEqual(row,next))continue;
    const paths=[];
    function diff(a,b,path=''){for(const key of Object.keys(a)){const p=path?path+'.'+key:key;if(key==='department'||key==='departments'){if(!isDeepStrictEqual(a[key],b[key]))paths.push(p);}else if(a[key]&&typeof a[key]==='object'&&!(a[key] instanceof Date))diff(a[key],b[key],p);}}
    diff(row,next);report.records.push({collection:name,id:row._id,fields:paths});report.fields+=paths.length;
    if(apply)await database.collection(name).replaceOne({_id:row._id},next,{session});
   }
  }
  const table=database.collection('institutionPolicy'),old=await table.findOne({_id:'institution'},{session});
  const next=normalizeDepartmentFields({...old,_id:'institution',departments:old?.departments||['ISE'],departmentAliases:{...old?.departmentAliases,...demoDepartmentAliases}},demoDepartmentAliases);
  report.policyChanged=!isDeepStrictEqual(old,next);
  if(apply&&report.policyChanged)await table.replaceOne({_id:'institution'},next,{session,upsert:true});
 });return report;}finally{await session.endSession();}
}
