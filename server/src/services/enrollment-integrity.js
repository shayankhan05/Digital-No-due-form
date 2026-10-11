// Explicit, transactional repair for legacy duplicate active pairs. Never delete
// an enrollment or marks document: historical references keep their original IDs.
export async function enrollmentDuplicates(database,session){
 return database.collection('enrollments').aggregate([
  {$match:{active:true,studentId:{$type:'string'},offeringId:{$type:'string'}}},
  {$group:{_id:{studentId:'$studentId',offeringId:'$offeringId'},count:{$sum:1},ids:{$push:'$_id'}}},
  {$match:{count:{$gt:1}}},{$sort:{'_id.studentId':1,'_id.offeringId':1}}
 ],{session}).toArray();
}
export async function repairEnrollmentDuplicates(database,client,{apply=false}={}){
 const session=client.startSession();let result;
 try{await session.withTransaction(async()=>{
  const groups=await enrollmentDuplicates(database,session),plans=[],conflicts=[];
  for(const group of groups){
   const rows=await database.collection('enrollments').find({_id:{$in:group.ids}},{session}).toArray(),o=await database.collection('offerings').findOne({_id:group._id.offeringId},{session});
   if(!o||rows.some(r=>r.teacherId!==o.teacherId)){conflicts.push({pair:group._id,error:'Offering/teacher mapping requires explicit review.'});continue;}
   const marks=await database.collection('marks').find({_id:{$in:group.ids}},{session}).toArray(),byId=new Map(marks.map(m=>[m._id,m])),scores={};let conflict=false;
   for(const m of marks){if(m.studentId&&m.studentId!==group._id.studentId||m.offeringId&&m.offeringId!==group._id.offeringId){conflicts.push({pair:group._id,error:'Marks ownership mismatch.',marksId:m._id});conflict=true;continue;}
    for(const [key,value]of Object.entries(m.scores||{})){if(value===null||value===undefined||value==='')continue;if(key in scores&&scores[key]!==value){conflicts.push({pair:group._id,assessment:key,values:[scores[key],value],error:'Conflicting marks preserved; no automatic overwrite.'});conflict=true;}else scores[key]=value;}
   }
   if(conflict)continue;
   const canonicalId=group._id.studentId+'__'+group._id.offeringId;
   // Prefer the stable pair ID, otherwise the most complete marks, then a stable
   // ID ordering. Conflicting marks above always stop repair, regardless of rank.
   rows.sort((a,b)=>Number(b._id===canonicalId)-Number(a._id===canonicalId)||Object.keys(byId.get(b._id)?.scores||{}).length-Object.keys(byId.get(a._id)?.scores||{}).length||a._id.localeCompare(b._id));
   const canonical=rows[0],redundant=rows.slice(1),previous=byId.get(canonical._id),source=previous||marks.find(m=>m._id===canonical._id)||marks.sort((a,b)=>a._id.localeCompare(b._id))[0];
   plans.push({pair:group._id,canonicalId:canonical._id,archivedIds:redundant.map(r=>r._id),mergedScores:scores});
   if(apply){
    if(source&&JSON.stringify(previous?.scores||{})!==JSON.stringify(scores))await database.collection('marks').updateOne({_id:canonical._id},{$set:{...Object.fromEntries(Object.entries(source).filter(([key])=>key!=='_id')),scores,studentId:group._id.studentId,offeringId:group._id.offeringId,teacherId:o.teacherId,enrollmentRepairSources:marks.map(m=>m._id)}},{upsert:true,session});
    await database.collection('enrollments').updateMany({_id:{$in:redundant.map(r=>r._id)},active:true},{$set:{active:false,duplicateOf:canonical._id,archivedAt:new Date(),archiveReason:'duplicate-active-student-offering'}},{session});
   }
  }
  if(apply&&conflicts.length)throw Object.assign(new Error('Conflicting enrollment/marks groups require review; no repair committed.'),{conflicts});
  result={applied:apply,duplicateGroups:groups.length,plans,conflicts};
 });return result;}finally{await session.endSession();}
}
