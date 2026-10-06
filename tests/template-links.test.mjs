import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {parseCSV} from '../js/csv.js';
const names=['student-import','teacher-import','offering-import','ise-5c-2022-confirmed'];
test('all four admin template links name existing real CSV files',async()=>{
  const source=await readFile(new URL('../js/institutional-admin.js',import.meta.url),'utf8');
  for(const name of names){assert.ok(source.includes(`href="templates/${name}.csv" download="${name}.csv"`));assert.ok((await readFile(new URL(`../templates/${name}.csv`,import.meta.url),'utf8')).trim());assert.ok(!source.includes(`templates/${name}.csv.txt`));}
});
test('template headers and five teacher-offering rows match the current parser and assessment format',async()=>{
  const headers={student:'name,usn,collegeEmail,phone,department,semester,section,scheme,mentorEmail',teacher:'name,collegeEmail,phone,department,employeeId,role',offering:'department,scheme,semester,section,subjectCode,subjectName,teacherEmail,credits,components'};
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
