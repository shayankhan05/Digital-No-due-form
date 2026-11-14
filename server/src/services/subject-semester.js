import {validSemester} from '../../../js/semester.js';
import {createHash} from 'node:crypto';
export const newSubjectId=row=>'subject_'+createHash('sha256').update([row.department,row.scheme,Number(row.semester),row.subjectCode||row.code].join('|')).digest('hex').slice(0,32);
export async function subjectSemester(repo,subject){
 if(subject.semester!==undefined&&subject.semester!==null)return validSemester(subject.semester)?Number(subject.semester):null;
 const linked=await repo.collection('offerings').where('subjectId','==',subject.id).get();
 const values=[...new Set(linked.docs.map(d=>Number(d.data().semester)))];
 return values.length===1&&Number.isInteger(values[0])&&values[0]>=1&&values[0]<=8?values[0]:null;
}
export async function subjectsInSemester(repo,docs,semester){
 const result=[];
 for(const doc of docs){const value=await subjectSemester(repo,{...doc.data(),id:doc.id});if(value===null)throw Object.assign(Error('Subject master has an ambiguous historical semester. Review it before importing.'),{code:'invalid-argument'});if(value===Number(semester))result.push(doc);}
 return result;
}
