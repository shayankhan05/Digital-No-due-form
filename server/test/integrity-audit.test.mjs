import {test} from 'node:test';
import assert from 'node:assert/strict';
import {identityReservationPlan} from '../src/services/integrity-audit.js';

test('identity reservations are additive, normalize identifiers and rerun without changes',()=>{
 const data={users:[{_id:'student1',role:'student',email:'Student@college.edu'},{_id:'faculty1',role:'subject_faculty',email:'faculty@college.edu',facultyId:'emp001'}],students:[{_id:'student1',usn:'1ay24is001'}],uniqueIdentities:[]};
 const plan=identityReservationPlan(data);
 assert.equal(plan.conflicts.length,0);assert.equal(plan.additions.length,6);
 assert.equal(plan.additions.filter(r=>r.uid==='student1').length,3);
 assert.equal(identityReservationPlan({...data,uniqueIdentities:plan.additions}).additions.length,0);
 const original=structuredClone(data);
 const collision=identityReservationPlan({...data,users:[...data.users,{_id:'other',email:'STUDENT@college.edu'}]});
 assert.ok(collision.conflicts.length);assert.equal(collision.additions.length,0);assert.deepEqual(data,original);
 const stolen=identityReservationPlan({...data,uniqueIdentities:[{...plan.additions[0],uid:'other'}]});
 assert.ok(stolen.conflicts.length);assert.equal(stolen.additions.length,0);
});
