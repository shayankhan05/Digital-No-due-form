import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planPresentationCleanup,planFormerHodEmailRelease} from '../src/services/presentation-cleanup.js';
function fixture(){
 const old={_id:'former',name:'Dr. Kavita Rao',email:'hod.cse@demo.test',role:'hod',departmentId:'cse',facultyId:'CSE-HOD-001',accountStatus:'inactive',hodRevokedAt:new Date()};
 const current={_id:'current',name:'Dr. Suresh Menon',email:'hod2@demo.test',role:'hod',departmentId:'cse',facultyId:'CSE-DEMO-AB'};
 const department={_id:'cse',code:'CSE',hodId:'current'};
 const snapshot={users:[old,current,{_id:'office',email:'office.cse@demo.test',name:'Office',role:'office',scope:'department',departmentId:'cse'}],departments:[department],departmentWorkflows:[{_id:'cse',hodId:'current',officeId:'office'}],departmentLeadershipHistory:[{_id:'1',departmentId:'cse',position:'hod',oldId:'former',newId:'middle'},{_id:'2',departmentId:'cse',position:'hod',oldId:'middle',newId:'current'}],uniqueIdentities:[{_id:'email_'+createHash('sha256').update(old.email).digest('hex'),uid:old._id}]};
 const auth=snapshot.users.map(u=>({uid:u._id,email:u.email,disabled:false}));return {snapshot,auth,department,current};
}
test('verified former HOD email release precedes canonical current HOD mapping without mutation',()=>{
 const {snapshot,auth}=fixture(),before=structuredClone(snapshot),plan=planPresentationCleanup(snapshot,auth);
 assert.deepEqual(plan.conflicts,[]);assert.equal(plan.hodEmailReconciliations.length,1);
 assert.deepEqual(plan.identities.map(i=>[i.uid,i.email]),[['former','kavita.rao.cse@demo.test'],['current','hod.cse@demo.test']]);
 assert.equal(plan.identities[1].dependsOnUid,'former');assert.equal(plan.counts.hodEmails,1);assert.equal(plan.counts.passwordResets,0);assert.deepEqual(snapshot,before);
 // Project only the email actions: rerunning the planner is idempotent.
 for(const i of plan.identities){snapshot.users.find(u=>u._id===i.uid).email=i.email;auth.find(u=>u.uid===i.uid).email=i.email;}
 assert.deepEqual(planPresentationCleanup(snapshot,auth).identities,[]);
});
for(const [label,alter] of [
 ['active owner',f=>f.snapshot.users[0].accountStatus='active'],
 ['different department',f=>f.snapshot.users[0].departmentId='ise'],
 ['no revocation',f=>delete f.snapshot.users[0].hodRevokedAt],
 ['missing history',f=>f.snapshot.departmentLeadershipHistory=[]],
 ['Auth ownership mismatch',f=>f.auth[0].uid='unrelated'],
 ['reserved replacement email',f=>f.auth.push({uid:'other',email:'kavita.rao.cse@demo.test'})],
 ['identity reservation mismatch',f=>f.snapshot.uniqueIdentities[0].uid='other'],
 ['workflow disagreement',f=>f.snapshot.departmentWorkflows[0].hodId='other'],
 ['still current elsewhere',f=>f.snapshot.departments.push({_id:'other',hodId:'former'})]
])test('unsafe reconciliation remains blocked: '+label,()=>{
 const f=fixture();alter(f);assert.equal(planFormerHodEmailRelease(f.snapshot,f.auth,f.department,f.current,'hod.cse@demo.test'),null);
 assert.ok(planPresentationCleanup(f.snapshot,f.auth).conflicts.length);assert.equal(planPresentationCleanup(f.snapshot,f.auth).hodEmailReconciliations.length,0);
});

test('operational faculty hygiene hides explicit load-test teachers while retaining realistic and ambiguous identities',async()=>{const {selectableFaculty}=await import('../../js/faculty-eligibility.js');assert.equal(selectableFaculty({name:'Teacher 12',email:'teacher12@load.test'}),false);assert.equal(selectableFaculty({name:'Sana Mir',email:'sana.mir@demo.test'}),true);assert.equal(selectableFaculty({name:'Demo mentor',email:'mentor@demo.test'}),true);assert.equal(selectableFaculty({name:'Temporary Teacher 1',email:'temporary@demo.test'}),false);});
