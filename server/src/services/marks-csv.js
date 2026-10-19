import {assertSemester} from '../../../js/semester.js';
import {isFaculty} from '../../../js/capabilities.js';
import {assertDepartment} from './department-master.js';
import {isInactive} from './account-removal.js';
import {isManager} from './roles.js';
import {compareUSN} from '../../../js/marks-roster.js';
import {departmentCode,departmentLabel} from '../../../js/department.js';
import {parseCSV} from '../../../js/csv.js';
import {matchesStudent} from './clearance.js';
const base=['usn','name','collegeEmail','department','scheme','semester','section','subjectCode','subjectName'];
const fail=(message,code='invalid-argument')=>{throw Object.assign(new Error(message),{code});};
const text=v=>String(v??'').trim(),upper=v=>text(v).toUpperCase();
// The same schema supplies export headers and import aliases. Never guess an
// assessment from its column position: every accepted name resolves uniquely.
export const normalizeMarksHeader=value=>text(value).replace(/\uFEFF/g,'').normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/[–—]/g,'-').replace(/[\s._/()[\]:-]+/g,'');
const safeHeader=value=>/^[=+@\-\t\r]/.test(value)?"'"+value:value;
export function assessmentColumns(o){
 const labels=o.components.map(c=>text(c.label)),keys=labels.map(normalizeMarksHeader),reserved=new Set(base.map(normalizeMarksHeader));
 const columns=o.components.map((c,i)=>({id:c.id,max:c.max,header:safeHeader(keys.filter(k=>k===keys[i]).length===1&&!reserved.has(keys[i])?labels[i]:`Assessment [${c.id}]`)}));
 // A literal label can itself resemble a generated disambiguation header.
 if(new Set(columns.map(c=>normalizeMarksHeader(c.header))).size!==columns.length)return columns.map(c=>({...c,header:`assessment_${c.id}`}));
 return columns;
}
function schema(o){
 const columns=assessmentColumns(o),aliases=new Map();
 const add=(alias,key)=>{const normalized=normalizeMarksHeader(alias);if(aliases.has(normalized)&&aliases.get(normalized)!==key)aliases.set(normalized,null);else if(!aliases.has(normalized))aliases.set(normalized,key);};
 for(const key of base)add(key,key);
 for(const c of columns){add(c.header,c.header);add(`assessment_${c.id}`,c.header);
  // Older templates used component IDs, IA1, IA 1 or Internal Assessment 1.
  if(!base.some(key=>normalizeMarksHeader(key)===normalizeMarksHeader(c.id)))add(c.id,c.header);
  const ia=/^ia(\d+)$/i.exec(c.id);if(ia)add(`Internal Assessment ${ia[1]}`,c.header);
 }
 return {columns,aliases,exact:new Map([...base,...columns.map(c=>c.header)].map(key=>[key,key]))};
}
export async function marksRoster(store,actor,id,{allowManager=false}={}){
 if(!/^[A-Za-z0-9_-]{1,200}$/.test(id))fail('Invalid offering.');const o=(await store.doc(`offerings/${id}`).get()).data();if(o)await assertDepartment(store,actor,'offerings',o);
 if(!o||o.active===false||!(allowManager&&isManager(actor.role))&&(!isFaculty(actor)||o.teacherId!==actor.uid))fail('Only the assigned teacher may manage this offering.','permission-denied');
 const enrollments=await store.collection('enrollments').where('offeringId','==',id).where('teacherId','==',o.teacherId).where('active','==',true).get(),ids=enrollments.docs.map(d=>d.data().studentId);
 const students=ids.length?(await store.collection('students').where('__name__','in',ids).get()).docs:[],byId=new Map(students.filter(d=>!isInactive(d.data())).map(d=>[d.id,d.data()])),marks=await store.collection('marks').where('offeringId','==',id).get(),scores=new Map(marks.docs.map(d=>[d.id,d.data()]));
 const rows=enrollments.docs.filter(e=>byId.has(e.data().studentId)&&matchesStudent(byId.get(e.data().studentId),o)).map(e=>({enrollmentId:e.id,enrollment:e.data(),student:byId.get(e.data().studentId),marks:scores.get(e.id)||{}})).sort((a,b)=>compareUSN(a.student.usn,b.student.usn));
 return {offering:{...o,id},columns:assessmentColumns(o),rows,departmentAliases:(await store.doc('settings/institution').get()).data()?.departmentAliases||{}};
}
function cell(v){let value=String(v??'');if(/^[=+@\-\t\r]/.test(value))value="'"+value;return '"'+value.replaceAll('"','""')+'"';}
export async function exportMarks(store,actor,id){const roster=await marksRoster(store,actor,id),o=roster.offering,headers=[...base,...roster.columns.map(c=>c.header)],records=roster.rows.map(({student:s,marks:m})=>[s.usn,s.name,s.email,departmentLabel(s.department),s.scheme,s.semester,s.section,o.subjectCode,o.subjectName,...roster.columns.map(c=>m.scores?.[c.id]??'')]);return {csv:'\uFEFF'+[headers,...records].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n',filename:`marks-${o.subjectCode}-${o.semester}-${o.section}.csv`,columns:roster.columns,students:records.length};}
function validate(csv,roster){
 if(typeof csv!=='string'||csv.length>600000)fail('Choose a marks CSV smaller than 512 KB.');const parsed=parseCSV(csv,[]);if(!parsed.length||parsed.length>2000)fail('Import 1–2000 marks rows.');
 const contract=schema(roster.offering),mapped=new Map(),seen=new Set();
 for(const header of Object.keys(parsed[0])){const key=contract.exact.get(header)||contract.aliases.get(normalizeMarksHeader(header));if(!key)fail(`Unknown or ambiguous CSV header: ${header}. Use the exported headers for this offering.`);if(seen.has(key))fail(`Duplicate CSV columns resolve to ${key}.`);seen.add(key);mapped.set(header,key);}
 for(const key of base)if(!seen.has(key))fail(`Missing CSV header: ${key}`);
 const inputs=parsed.map(row=>{const input=Object.fromEntries([...mapped].map(([header,key])=>[key,row[header]]));input.department=departmentCode(input.department,roster.departmentAliases);return input;}),columns=contract.columns.filter(c=>seen.has(c.header));if(!columns.length)fail('Include at least one configured assessment column.');
 const counts=new Map();for(const r of inputs)counts.set(upper(r.usn),(counts.get(upper(r.usn))||0)+1);const byUsn=new Map();for(const row of roster.rows){const key=upper(row.student.usn);if(!byUsn.has(key))byUsn.set(key,[]);byUsn.get(key).push(row);}
 const o=roster.offering;return inputs.map((input,index)=>{try{assertSemester(input.semester);const usn=upper(input.usn);if(counts.get(usn)>1)fail('Duplicate USN in CSV.');if(!matchesStudent(input,o)||upper(input.subjectCode)!==upper(o.subjectCode)||text(input.subjectName)!==text(o.subjectName))fail(`CSV class does not match the selected offering: ${o.subjectCode}, semester ${o.semester}, section ${o.section}, ${departmentLabel(o.department)||'any department'}, scheme ${o.scheme||'any'}. Open the matching class and export its CSV.`);const candidates=byUsn.get(usn)||[];if(!candidates.length)fail('Student is not enrolled in this offering.');if(candidates.length>1)fail('Enrollment data-integrity error: multiple active enrollments or student identities resolve to this USN. An administrator must repair them.');const [r]=candidates;if(text(input.collegeEmail).toLowerCase()!==text(r.student.email).toLowerCase())fail('USN and college email do not identify the same enrolled student.');if(!matchesStudent(input,{...o,department:o.department||r.student.department})||text(input.scheme)!==text(o.scheme||r.student.scheme)||upper(input.subjectCode)!==upper(o.subjectCode)||text(input.subjectName)!==text(o.subjectName))fail('Department/scheme/semester/section/subject does not match this offering.');const scores={};for(const c of columns){const value=text(input[c.header]);if(!value)continue;if(!/^\d+(\.\d+)?$/.test(value)||!Number.isFinite(Number(value))||Number(value)>c.max)fail(`${c.header}: enter a number from 0 to ${c.max}.`);scores[c.id]=Number(value);}if(!Object.keys(scores).length)fail('No marks specified; existing marks will be preserved.');return {index,status:'VALID',usn,name:r.student.name,enrollmentId:r.enrollmentId,scores,warnings:text(input.name)!==text(r.student.name)?['Name differs; USN/email identify the enrolled student.']:[]};}catch(e){return {index,status:'ERROR',usn:input.usn,name:input.name,error:e.message};}});
}
export async function previewMarks(store,actor,id,csv){const roster=await marksRoster(store,actor,id),rows=validate(csv,roster);return {rows,valid:rows.filter(r=>r.status==='VALID').length,errors:rows.filter(r=>r.status==='ERROR').length,columns:roster.columns};}
export async function importMarks(store,actor,id,csv){let result;await store.runTransaction(async tx=>{const roster=await marksRoster(tx.store,actor,id),rows=validate(csv,roster),valid=rows.filter(r=>r.status==='VALID');if(!valid.length)fail('No valid marks rows to import.');
 // Serialize concurrent bulk edits for this offering, then merge each record.
 tx.update(store.doc(`offerings/${id}`),{marksImportRevision:(roster.offering.marksImportRevision||0)+1});
 for(const row of valid){const ref=store.doc(`marks/${row.enrollmentId}`),previous=(await tx.get(ref)).data()||{},source=roster.rows.find(e=>e.enrollmentId===row.enrollmentId),scores={...(previous.scores||{}),...row.scores};if(JSON.stringify(scores)===JSON.stringify(previous.scores||{}))continue;const guard=store.doc('students/'+source.enrollment.studentId),student=(await tx.get(guard)).data();if(!student||isInactive(student))fail('Student is inactive or being removed.');tx.update(guard,{academicHistoryRevision:(student.academicHistoryRevision||0)+1});tx.set(ref,{...previous,studentId:source.enrollment.studentId,offeringId:id,teacherId:actor.uid,mentorId:source.enrollment.mentorId,subjectId:roster.offering.subjectId,subjectCode:roster.offering.subjectCode,semester:roster.offering.semester,section:roster.offering.section,scores,updatedBy:actor.uid,updatedAt:new Date()});}result={imported:valid.length,skipped:rows.length-valid.length,rows};});return result;}
