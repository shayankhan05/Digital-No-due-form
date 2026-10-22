import {isInactive} from './account-removal.js';
export const serviceFields={library:'library',accounts:'accounts',physics_lab:'physics_lab',chemistry_lab:'chemistry_lab',sports:'sports'};
export function eligibleConfigurationAccount(user){
 return !!user&&!isInactive(user)&&user.authDisabled!==true&&user.configurationSelectable!==false&&!!String(user.name||'').trim()&&!/^(?:[a-z]\d+|(?:test|placeholder)(?:[\s_-].*)?)$/i.test(String(user.name).trim());
}
// Resolve the existing institution policy; never select the first of ambiguous users.
export async function institutionServices(database){
 const policy=await database.collection('institutionPolicy').findOne({_id:'workflow'})||{},configs=await database.collection('departmentWorkflows').find({}).toArray(),result={};
 const selected=Object.fromEntries(Object.keys(serviceFields).map(field=>{const ids=[...new Set(configs.map(c=>c[field]).filter(Boolean))];return[field,policy[field]||(ids.length===1?ids[0]:null)];})),users=new Map((await database.collection('users').find({_id:{$in:Object.values(selected).filter(Boolean)}}).toArray()).map(u=>[u._id,u]));
 for(const[field,role]of Object.entries(serviceFields)){const user=users.get(selected[field]);result[field]=user&&user.role===role&&!isInactive(user)&&user.authDisabled!==true&&user.scope==='institution'&&user.configurationSelectable!==false?{uid:user._id,role,name:user.name,email:user.email}:null;}
 return result;
}
