const contains=(value,id)=>typeof value==='string'?value===id:Array.isArray(value)?value.some(v=>contains(v,id)):value&&typeof value==='object'&&!(value instanceof Date)?Object.values(value).some(v=>contains(v,id)):false;
const roles=['hod','office','library','accounts','physics_lab','chemistry_lab'];
const placeholder=user=>/^(?:[a-z]\d+|test(?:[\s_-].*)?|placeholder|library|accounts|physics_lab|chemistry_lab)$/i.test(String(user.name||'').trim());
export function planConfigurationCleanup(snapshot){
 const policy=snapshot.institutionPolicy?.find(p=>p._id==='workflow')||{},canonical=new Set(['officeId','library','accounts','physics_lab','chemistry_lab'].map(f=>policy[f]).filter(Boolean));
 for(const d of snapshot.departments||[])for(const f of ['adminId','departmentAdminId','hodId'])if(d[f])canonical.add(d[f]);
 return (snapshot.users||[]).filter(u=>roles.includes(u.role)&&(canonical.has(u._id)||placeholder(u))).map(u=>{
  const references=[];for(const[col,rows]of Object.entries(snapshot))for(const r of rows)if(!(col==='users'&&r._id===u._id)&&contains(r,u._id))references.push({collection:col,id:r._id,status:r.status});
  const current=references.some(r=>['departments','departmentWorkflows','institutionPolicy'].includes(r.collection)||r.collection==='noDueRequests'&&!['issued','cancelled','completed'].includes(r.status));
  const classification=canonical.has(u._id)?'KEEP_CANONICAL':current?'ACTIVE_REAL':references.length?'HISTORICAL_ONLY':'SAFE_TO_DEACTIVATE';
  return {uid:u._id,email:u.email,name:u.name,role:u.role,classification,action:canonical.has(u._id)?'KEEP':classification==='SAFE_TO_DEACTIVATE'?'DEACTIVATE':'EXCLUDE_FROM_CONFIGURATION',references};
 });
}
