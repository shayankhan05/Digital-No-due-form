import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {parseCSV} from '../js/csv.js';
import {studentHeaders,repairSources} from './institutional-profile-tools.mjs';
test('confirmed 155–169 CSV covers all fifteen identities with the exact importer schema',async()=>{
  const rows=parseCSV(await readFile(new URL('../templates/demo-students-155-169.csv',import.meta.url),'utf8'),studentHeaders);
  assert.equal(rows.length,15);assert.equal(new Set(rows.map(r=>r.usn)).size,15);assert.deepEqual(rows.map(r=>r.usn).sort(),Array.from({length:15},(_,i)=>`1AY24IS${155+i}`));
  for(const row of rows){assert.equal(row.collegeEmail,`ise-demo-${row.usn.toLowerCase()}@demo.test`);assert.equal(row.department,'ISE');assert.equal(row.semester,'5');assert.equal(row.scheme,'2022');assert.equal(row.mentorEmail,'mentor@demo.test');}
  assert.equal(rows.find(r=>r.usn==='1AY24IS158').name,'Ayesha Siddiqui');assert.equal(rows.find(r=>r.usn==='1AY24IS160').name,'Vihaan Kapoor');assert.equal(rows.find(r=>r.usn==='1AY24IS169').name,'Anaya Deshmukh');
});
test('repair sources include later imported students beyond the original fifty',async()=>{
  const sources=await repairSources();for(const n of [101,150,155,156,157,158,159,160,169])assert.ok(sources.has(`ise-demo-1ay24is${n}@demo.test`));
  assert.equal(sources.get('ise-demo-1ay24is158@demo.test').row.section,'C');assert.equal(sources.get('ise-demo-1ay24is156@demo.test').row.section,'A');
});
test('security suite refuses the current demo before any Firestore reset',()=>{
  const env={...process.env,TEST_PROJECT_ID:'demo-digital-no-due',TEST_FIRESTORE_PORT:'8180',TEST_AUTH_PORT:'9199'};
  delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['--loader','./firebase-loader.mjs','--test','security.test.mjs'],{cwd:new URL('.',import.meta.url),env,encoding:'utf8',timeout:30000});
  assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/Security tests may clear ONLY demo-digital-no-due-audit/);assert.doesNotMatch(result.stdout+result.stderr,/Firestore \(.*GrpcConnection/);
});
