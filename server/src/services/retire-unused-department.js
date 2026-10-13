// An unused master can be retired without rewriting any institutional/history data.
// Fail closed if live references appear: a populated department needs a reviewed migration.
export async function retireUnusedDepartment(database,client,{sourceCode='CS',canonicalCode='CSE',apply=false}={}){
 const source=await database.collection('departments').findOne({code:sourceCode}),canonical=await database.collection('departments').findOne({code:canonicalCode,status:'active'});
 if(!source||!canonical||source._id===canonical._id)throw Error('Distinct source and active canonical departments are required.');
 const references=[],historical=[],values=new Set([source._id,source.code,source.name]);
 const matches=value=>typeof value==='string'?values.has(value):Array.isArray(value)?value.some(matches):value&&typeof value==='object'&&!(value instanceof Date)?Object.values(value).some(matches):false;
 for(const {name}of await database.listCollections().toArray())if(!name.startsWith('system.'))for(const row of await database.collection(name).find({}).toArray()){
  if(name==='departments'&&row._id===source._id)continue;
  if(matches(row))(name==='superAdminAudit'||name==='departmentLeadershipHistory'?historical:references).push({collection:name,id:row._id});
 }
 const result={sourceId:source._id,canonicalId:canonical._id,liveReferences:references,historicalReferences:historical,beforeActive:source.status==='active'?1:0,changed:0};
 if(references.length)throw Object.assign(Error('Source department is in use; a reviewed reference migration is required.'),{references});
 if(apply&&source.status!=='inactive'){
  const session=client.startSession();try{await session.withTransaction(async()=>{
   const updated=await database.collection('departments').updateOne({_id:source._id,status:source.status},{$set:{status:'inactive',retiredToDepartmentId:canonical._id}},{session});
   if(updated.modifiedCount!==1)throw Error('Department changed since inspection.');result.changed=1;
  });}finally{await session.endSession();}
 }
 return {...result,afterActive:apply?0:result.beforeActive};
}
