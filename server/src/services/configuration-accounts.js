import {isInactive} from './account-removal.js';
export const serviceFields={officeId:'office',library:'library',accounts:'accounts',physics_lab:'physics_lab',chemistry_lab:'chemistry_lab'};
export function eligibleConfigurationAccount(user){
 return !!user&&!isInactive(user)&&user.authDisabled!==true&&user.configurationSelectable!==false&&!!String(user.name||'').trim()&&!/^(?:[a-z]\d+|(?:test|placeholder)(?:[\s_-].*)?)$/i.test(String(user.name).trim());
}
// Resolve the existing institution policy; never select the first of ambiguous users.
export async function institutionServices(database){
 const policy=await database.collection('institutionPolicy').findOne({_id:'workflow'})||{},configs=await database.collection('departmentWorkflows').find({}).toArray(),result={};
 for(const[field,role]of Object.entries(serviceFields)){
  const ids=[...new Set(configs.map(c=>c[field]).filter(Boolean))],uid=policy[field]||(ids.length===1?ids[0]:null),user=uid&&await database.collection('users').findOne({_id:uid,role});
  result[field]=user&&!isInactive(user)&&user.authDisabled!==true&&user.scope==='institution'&&user.configurationSelectable!==false?{uid:user._id,role,name:user.name,email:user.email}:null;
 }
 return result;
}
