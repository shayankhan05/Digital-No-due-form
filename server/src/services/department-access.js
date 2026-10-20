import {departmentOf} from './department-master.js';
export const DEPARTMENT_INACTIVE_MESSAGE='Your department is currently inactive. Please contact the institution administrator.';
// Department state gates access, never cascades changes into account records.
export async function departmentAccessError(database,profile,uid=profile._id){
 if(profile.role==='super_admin'||profile.scope==='institution')return null;
 let id=await departmentOf(database,'users',{...profile,scope:'department'});
 if(!id&&profile.role==='student')id=await departmentOf(database,'students',await database.collection('students').findOne({_id:uid}));
 const department=id&&await database.collection('departments').findOne({_id:id},{projection:{status:1}});
 return department?.status==='inactive'?{code:'department/inactive',message:DEPARTMENT_INACTIVE_MESSAGE}:null;
}
