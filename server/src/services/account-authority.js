import {departmentOf} from './department-master.js';
// A stored role is not evidence of a current leadership assignment.
// Historical approval documents retain their original actor UID.
export async function accountAuthority(database,profile,uid){
 if(profile.role!=='hod')return profile;
 const departmentId=await departmentOf(database,'users',{...profile,scope:'department'});
 const department=departmentId&&await database.collection('departments').findOne({_id:departmentId});
 const legacy=!department&&!(await database.collection('departments').countDocuments())&&await database.collection('institutionPolicy').findOne({_id:'workflow',hodId:uid});
 if(department?.hodId===uid||legacy)return {...profile,...(department?{departmentId:department._id}:{}),currentHod:true};
 const faculty=profile.leadershipPreviousRole==='subject_faculty'||await database.collection('offerings').countDocuments({teacherId:uid,active:{$ne:false}});
 if(faculty)return {...profile,role:'subject_faculty',currentHod:false};
 throw Object.assign(Error('Your HOD assignment is no longer current. Contact the administrator.'),{code:'account/leadership-revoked'});
}

export async function retireHodAuthority(database,session,uid,departmentId,newUid){
 if(!uid)return;
 const old=await database.collection('users').findOne({_id:uid},{session});if(!old)return;
 const faculty=old.leadershipPreviousRole==='subject_faculty'||await database.collection('offerings').countDocuments({teacherId:uid},{session});
 const mentor=old.leadershipPreviousRole==='mentor'||old.isMentor===true||await database.collection('students').countDocuments({mentorId:uid},{session});
 await database.collection('users').updateOne({_id:uid},{$set:faculty||mentor?{role:faculty?'subject_faculty':'mentor',isMentor:!!mentor,hodRevokedAt:new Date()}:{accountStatus:'inactive',hodRevokedAt:new Date(),inactiveReason:'HOD assignment replaced'}},{session});
 if(newUid){
  const students=await database.collection('students').find({departmentId},{session,projection:{_id:1}}).toArray(),ids=students.map(s=>s._id);
  await database.collection('noDueRequests').updateMany({studentId:{$in:ids},hodId:uid,status:{$in:['pending_stage1','pending_mentor','pending_hod','rejected']},'hodApproval.status':{$ne:'approved'}},{$set:{hodId:newUid},$inc:{version:1},$push:{hodAssignmentHistory:{oldId:uid,newId:newUid,changedAt:new Date()}}},{session});
  await database.collection('clearancePlans').updateMany({_id:{$in:ids},hodId:uid},{$set:{hodId:newUid}},{session});
 }
}
