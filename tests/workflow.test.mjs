import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stage1Change,resumeChange} from '../js/workflow-model.js';
import {parseCSV} from '../js/csv.js';
test('all parallel approvals advance exactly once', () => {
  let r={status:'pending_stage1',remaining:2,approvalStates:{a:'pending',b:'pending'}};
  r={...r,...stage1Change(r,'a','approved')}; assert.equal(r.status,'pending_stage1');
  r={...r,...stage1Change(r,'b','approved')}; assert.equal(r.status,'pending_mentor'); assert.equal(r.remaining,0);
  assert.throws(()=>stage1Change(r,'a','approved'));
});
test('rejection and resubmission preserve prior approved items', () => {
  let r={status:'pending_stage1',remaining:1,approvalStates:{a:'approved',b:'pending'}};
  r={...r,...stage1Change(r,'b','rejected')}; assert.equal(r.remaining,1);
  r={...r,...resumeChange(r)}; assert.equal(r.approvalStates.a,'approved'); assert.equal(r.approvalStates.b,'pending');
  r={...r,...stage1Change(r,'b','approved')}; assert.equal(r.status,'pending_mentor');
});
test('mentor and HOD rejections resume their own stage', () => {
  assert.equal(resumeChange({status:'rejected',approvalStates:{},mentorApproval:{status:'rejected'},hodApproval:{status:'pending'}}).status,'pending_mentor');
  assert.equal(resumeChange({status:'rejected',approvalStates:{},mentorApproval:{status:'approved'},hodApproval:{status:'rejected'}}).status,'pending_hod');
});
test('CSV supports quoted commas, quotes and multiline values; requires Auth UID', () => {
  const rows=parseCSV('uid,name,usn,email,semester,section,mentorId\r\ns1,"Doe, Jane",USN,jane@test.com,6,C,m1'); assert.equal(rows[0].name,'Doe, Jane');
  assert.throws(()=>parseCSV('name,usn\nJane,USN'));
  assert.throws(()=>parseCSV('uid,name,usn,email,semester,section,mentorId\ns1,"Jane'));
});
