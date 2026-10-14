const compact=value=>String(value||'').normalize('NFKC').trim().toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const cseAliases=new Set(['computer science','computer science engineering','computer science and engineering']);
export const departmentNameKey=name=>{const key=compact(name);return cseAliases.has(key)?'computer science and engineering':key;};
export async function assertUniqueDepartment(database,{code,name,id,session}){
 const rows=await database.collection('departments').find(id?{_id:{$ne:id}}:{},{session}).toArray(),normalized=departmentNameKey(name),cse=rows.find(d=>String(d.code).toUpperCase()==='CSE');
 if(cse&&(['CS','CSE'].includes(code)||cseAliases.has(compact(name))))throw Object.assign(Error('Computer Science & Engineering (CSE) already exists.'),{code:'already-exists'});
 if(rows.some(d=>String(d.code).trim().toUpperCase()===code||departmentNameKey(d.name)===normalized))throw Object.assign(Error('Department code or normalized name already exists.'),{code:'already-exists'});
}
