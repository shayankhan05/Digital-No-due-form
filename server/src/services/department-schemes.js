// Derive displayed applicability from existing academic references without
// writing department settings or inventing schemes for empty departments.
export async function withUsedSchemes(database,departments,schemes){
 const records=[];
 for(const collection of ['students','offerings','subjects'])records.push(...await database.collection(collection).aggregate([{$match:{scheme:{$exists:true,$nin:['',null]},active:{$ne:false},accountStatus:{$nin:['inactive','deleted','exited','exiting']}}},{$group:{_id:{departmentId:'$departmentId',department:'$department',scheme:'$scheme'}}}]).toArray());
 const key=v=>String(v||'').trim().replace(/\s+scheme$/i,'').toLowerCase();
 return departments.map(department=>{const used=new Set(records.filter(r=>r._id.departmentId?r._id.departmentId===department._id:[department.code,department.name].some(v=>key(v)===key(r._id.department))).map(r=>key(r._id.scheme)));const inferred=schemes.filter(s=>used.has(key(s._id))||used.has(key(s.code))).map(s=>s._id);return {...department,applicableSchemeIds:[...new Set([...(department.schemeIds||[]),...inferred])]};});
}
