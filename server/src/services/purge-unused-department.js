export async function purgeUnusedCS(database,client,{apply=false}={}){
 const source=await database.collection('departments').findOne({code:'CS'}),canonical=await database.collection('departments').findOne({code:'CSE',status:'active'});
 if(!canonical)throw Error('Active canonical CSE department is required.');
 if(!source)return {removed:0,currentReferences:[],historicalReferences:[],canonicalId:canonical._id};
 if(source.status!=='inactive'||source.retiredToDepartmentId!==canonical._id)throw Error('Only the inspected retired CS master may be removed.');
 const normalized=v=>String(v).trim().toLowerCase(),values=new Set([source.code,source.name].map(normalized));
 // IDs are references anywhere. Codes/names must be department fields, not
 // unrelated Office search prefixes such as "cs" generated from "CSE".
 const contains=(v,departmentField=false)=>typeof v==='string'?normalized(v)===normalized(source._id)||departmentField&&values.has(normalized(v)):Array.isArray(v)?v.some(item=>contains(item,departmentField)):v&&typeof v==='object'&&!(v instanceof Date)?Object.entries(v).some(([key,item])=>contains(item,departmentField||/department/i.test(key))):false;
 const session=client.startSession();let report;
 try{await session.withTransaction(async()=>{
  const currentReferences=[],historicalReferences=[];
  for(const {name}of await database.listCollections().toArray())if(!name.startsWith('system.'))for(const row of await database.collection(name).find({},{session}).toArray()){
   if(name==='departments'&&row._id===source._id)continue;
   if(contains(row))(['superAdminAudit','departmentLeadershipHistory'].includes(name)?historicalReferences:currentReferences).push({collection:name,id:row._id});
  }
  if(currentReferences.length)throw Object.assign(Error('CS has operational dependencies; deletion refused.'),{references:currentReferences});
  report={sourceId:source._id,canonicalId:canonical._id,currentReferences,historicalReferences,removed:0};
  if(apply){const deleted=await database.collection('departments').deleteOne({_id:source._id,code:'CS',status:'inactive',retiredToDepartmentId:canonical._id},{session});if(deleted.deletedCount!==1)throw Error('CS changed since inspection.');report.removed=1;}
 });}finally{await session.endSession();}return report;
}
