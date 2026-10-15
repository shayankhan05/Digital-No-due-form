import {parseCSV} from './csv.js';
const aliases={college_email:'collegeEmail',department_code:'department',employee_id:'employeeId',faculty_employee_id:'employeeId',is_mentor:'isMentor',mentor_employee_id:'mentorEmployeeId',mentor_email:'mentorEmail',subject_code:'subjectCode',subject_name:'subjectName',teacher_email:'teacherEmail'};
const fields=new Set(['name','usn','collegeEmail','email','phone','department','semester','section','scheme','mentorEmployeeId','mentorEmail','mentorId','employeeId','facultyId','role','isMentor','subjectCode','subjectName','teacherEmail','credits','components','active']);
export const defaultComponents=[{id:'ia1',label:'IA1',max:30},{id:'ia2',label:'IA2',max:30},{id:'assignment',label:'Assignment',max:10}];
export function normalizeCollegeRow(raw,type){
 const row={};for(const[key,value]of Object.entries(raw)){const field=aliases[key]||key;if(!fields.has(field))throw new Error('Unknown CSV header: '+key);if(field in row)throw new Error('Duplicate CSV columns resolve to '+field);row[field]=typeof value==='string'?value.trim():value;}
 row.department=String(row.department||'').trim();if(row.collegeEmail===undefined&&row.email!==undefined)row.collegeEmail=row.email;
 if(type==='teachers'){row.role ||= 'subject_faculty';row.employeeId ||= row.facultyId;if(row.isMentor!==undefined&&!['true','false',true,false].includes(row.isMentor))throw new Error('is_mentor must be true or false.');}
 if(type==='students')row.role='student';
 if(['offerings','teaching'].includes(type)&&typeof row.components==='string'){if(row.components.startsWith('['))row.components=JSON.parse(row.components);else row.components=row.components.split('|').map(label=>{const id=label.toLowerCase().replace(/\s+/g,'');return{id,label,max:id==='assignment'?10:30};});}
 return row;
}
export function parseCollegeCSV(text,type){const rows=parseCSV(text,[]);return rows.map(row=>normalizeCollegeRow(row,type));}
