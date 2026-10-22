const roles={student:'Student',subject_faculty:'Subject Faculty',mentor:'Mentor',hod:'HOD',office:'Department Office',library:'Library',accounts:'Accounts',physics_lab:'Physics Lab',chemistry_lab:'Chemistry Lab',sports:'Sports Incharge',admin:'Admin',super_admin:'Super Admin'};
export const roleLabel=role=>roles[role]||String(role||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
export const isServiceAccount=account=>['office','library','accounts','physics_lab','chemistry_lab','sports'].includes(account.role);
const technical=account=>!account.name||/^(demo|test|mongo)[\s_-]/i.test(account.name)||/^[a-z]\d+$/i.test(account.name)||account.name.includes('@')||account.name.toLowerCase().replaceAll('_',' ')===String(account.role).replaceAll('_',' ');
// Display aliases only: option values, UIDs, email search and stored profiles stay unchanged.
export function accountLabel(account,peers=[]){
 if(!isServiceAccount(account)||!technical(account))return account.name||roleLabel(account.role);
 const base=account.role==='office'?(account.scope==='institution'?'Central Office':'Department Office'):roleLabel(account.role);
 const group=peers.filter(p=>p.role===account.role&&technical(p)&&(p.scope==='institution')===(account.scope==='institution')).sort((a,b)=>String(a.uid||a._id||a.email).localeCompare(String(b.uid||b._id||b.email)));
 const index=group.findIndex(p=>(p.uid||p._id||p.email)===(account.uid||account._id||account.email));
 return base+(index>0?' '+(index+1):'');
}

const auditLabels={ACCOUNT_IDENTITY_RESTORED:'Institutional identity restored',ACCOUNT_DEACTIVATED:'Account deactivated',ACCOUNT_REACTIVATED:'Account reactivated',ACCOUNT_INSTITUTIONAL_EXIT:'Permanent institutional exit',ACCOUNT_HARD_DELETED:'Account hard deleted',WORKFLOW_OFFICE_CHANGED:'Department Office changed',BULK_STUDENT_IMPORT:'Student CSV Import',BULK_FACULTY_IMPORT:'Faculty CSV Import',BULK_SUBJECT_IMPORT:'Subject CSV Import',BULK_ASSIGNMENT_IMPORT:'Class Assignment CSV Import',ACCOUNT_BULK_DELETED:'Accounts Permanently Removed',ACCOUNT_BULK_DEACTIVATED:'Account Deactivated',ACCOUNT_BULK_REACTIVATED:'Account Reactivated',HOD_REPLACED:'HOD Changed',HOD_ASSIGNED:'HOD Assigned',DEPARTMENT_ADMIN_REPLACED:'Department Admin Changed',DEPARTMENT_CREATED:'Department Created',DEPARTMENT_ADMIN_CREATED:'Department Admin Created',SECTION_CREATED:'Section Created',SECTION_ACTIVATED:'Section Activated',SECTION_DEACTIVATED:'Section Deactivated'};
export const auditActionLabel=action=>auditLabels[action]||String(action||'').toLowerCase().replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
