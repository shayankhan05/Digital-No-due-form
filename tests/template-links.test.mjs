import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {parseCSV} from '../js/csv.js';
import {collegeImportHTML,collegeImportFormats,collegeTemplate} from '../js/college-import-formats.js';
import {parseCollegeCSV} from '../js/college-csv.js';
const names=['student-import','teacher-import','offering-import','ise-5c-2022-confirmed'];
test('current admin template links point to real CSV files and the generated student template includes AUID',async()=>{
  const html=collegeImportHTML();
  for(const {file} of Object.values(collegeImportFormats)){assert.ok(html.includes('href="templates/'+file+'" download="'+file+'"'));assert.ok((await readFile(new URL('../templates/'+file,import.meta.url),'utf8')).trim());}
  const generated=parseCollegeCSV(collegeTemplate('students'),'students');
  assert.equal(generated[0].auid,'');assert.equal(generated[0].name,'Student Name');
});
test('template headers and five teacher-offering rows match the current parser and assessment format',async()=>{
  const headers={student:'name,usn,auid,collegeEmail,phone,department,semester,section,scheme,mentorEmail',teacher:'name,collegeEmail,phone,department,employeeId,role',offering:'department,scheme,semester,section,subjectCode,subjectName,teacherEmail,credits,components'};
  for(const [type,header] of Object.entries(headers))assert.equal((await readFile(new URL(`../templates/${type}-import.csv`,import.meta.url),'utf8')).trim(),header);
  const rows=parseCSV(await readFile(new URL('../templates/demo-teacher-offerings.csv',import.meta.url),'utf8'),headers.offering.split(','));assert.equal(rows.length,5);
  assert.deepEqual(rows.map(r=>r.teacherEmail),['aarav.mehta@demo.test','nida.farooq@demo.test','rohit.kulkarni@demo.test','sana.mir@demo.test','vivek.reddy@demo.test']);
  for(const row of rows){assert.equal(row.credits,'4');assert.deepEqual(JSON.parse(row.components).map(c=>c.id),['ia1','ia2','assignment']);}
});
test('both Hosting configurations include public templates while excluding other CSV data',async()=>{
  const require=createRequire(import.meta.url),{listFiles}=require('firebase-tools/lib/listFiles.js');
  for(const configPath of ['../firebase.json','firebase-isolated.json']){
    const config=JSON.parse(await readFile(new URL(configPath,import.meta.url),'utf8'));
    const files=listFiles(fileURLToPath(new URL('../',import.meta.url)),config.hosting.ignore);
    for(const name of names)assert.ok(files.includes(`templates/${name}.csv`));
    assert.ok(!files.includes('templates/demo-students-50.csv'));assert.ok(!files.includes('templates/demo-teacher-offerings.csv'));
  }
});
