// Stable codes are used for identity/matching; labels are used only for display.
export const ISE_LABEL='Information Science & Engineering';
const clean=value=>String(value??'').trim();
const iseNames=new Set(['ise','information science','information science & engineering','information science and engineering']);
export function departmentCode(value,aliases={}){
 const text=clean(value),key=text.toLowerCase();
 const alias=Object.entries(aliases).find(([name])=>clean(name).toLowerCase()===key)?.[1];
 const resolved=alias===undefined?text:clean(alias);
 return iseNames.has(resolved.toLowerCase())?'ISE':resolved;
}
export const departmentLabel=(value,aliases={})=>{const code=departmentCode(value,aliases);return code==='ISE'?ISE_LABEL:code;};
export function normalizeDepartmentFields(value,aliases={}){
 if(!value||typeof value!=='object'||value instanceof Date)return value;
 if(Array.isArray(value))return value.map(item=>normalizeDepartmentFields(item,aliases));
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='department'&&typeof item==='string'?departmentCode(item,aliases):key==='departments'&&Array.isArray(item)?[...new Set(item.map(v=>departmentCode(v,aliases)))]:normalizeDepartmentFields(item,aliases)]));
}
