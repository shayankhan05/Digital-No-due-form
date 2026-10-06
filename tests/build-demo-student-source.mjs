// Names/class assignments supplied by the user; no inferred academic fields.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const runtime='C:/Users/Hp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const require=createRequire(`${runtime}/runtime.cjs`),{Workbook}=await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const original=await readFile('C:/Users/Hp/Downloads/digital_no_due_5_new_students.csv','utf8');
const wb=await Workbook.fromCSV(original.replace(/^\uFEFF/,''),{sheetName:'Students'}),sheet=wb.worksheets.getItem('Students');
const headers=['name','usn','collegeEmail','phone','department','semester','section','scheme','mentorEmail'];
assert.deepEqual(sheet.getRange('A1:I1').values[0],headers);
const specified=[['Vihaan Kapoor','A'],['Meher Fatima','B'],['Aditya Nair','C'],['Inaya Rahman','A'],['Arjun Malhotra','B'],['Sara Qureshi','C'],['Devansh Rao','A'],['Hiba Noor','B'],['Karan Bhat','C'],['Anaya Deshmukh','A']];
sheet.getRange('A7:I16').values=specified.map(([name,section],i)=>[name,`1AY24IS${160+i}`,`ise-demo-1ay24is${160+i}@demo.test`,`9000000${160+i}`,'ISE',5,section,2022,'mentor@demo.test']);
wb.recalculate();const values=sheet.getRange('A1:I16').values;
assert.equal(new Set(values.slice(1).map(r=>r[1])).size,15);assert.equal(values[4][0],'Ayesha Siddiqui');assert.equal(values[15][1],'1AY24IS169');
// CSV is the requested application source format. Export the verified sheet
// values without spreadsheet formatting, comments or extra columns.
const quote=v=>/[,"\r\n]/.test(String(v))?'"'+String(v).replaceAll('"','""')+'"':String(v);
await writeFile(new URL('../templates/demo-students-155-169.csv',import.meta.url),values.map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n');
console.log('Verified CSV: 15 students, exact importer headers, unique USNs/emails.');
