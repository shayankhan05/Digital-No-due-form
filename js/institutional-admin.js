import {mountInstitutionServices} from './institution-services-ui.js';
import {mountWorkflowOversight} from './workflow-oversight.js';
import {mountProvisioningForms} from './provisioning-forms.js';
import {loadMasters} from './master-data.js';
import {collegeImportHTML} from './college-import-formats.js';
import {mountCollegeImport} from './college-import-ui.js';
import {mountSuperWorkspace} from './super-workspace.js';
import {roleLabel,accountLabel} from './display-labels.js';
import {mountDepartmentManagement} from './department-management.js';
import {departmentLabel} from './department.js';
import {wireAccountRemoval,wireAccountReactivation,mountExitManagement} from './account-removal.js';
import {requireAuth,wireLogout} from './auth.js';
import {functions,isEmulator} from './firebase-config.js';
import {httpsCallable} from "./api-callable.js";
import {parseCSV} from './csv.js';
import {page} from './academic.js';
import {escapeHtml as e,busy,errorState} from './ui.js';
import {ROLES} from './admin-data.js';
import {initThemeToggle} from './theme.js';
const callable=httpsCallable(functions,'institutionalAdmin',{timeout:540000});
const api=async(action,data={})=>(await callable({action,...data})).data;
const content=document.getElementById('content');
wireLogout();initThemeToggle();
let actor;
let preview=[],results=[],jobId='',previewPage=0,exitManager;
const field=(name,label,type='text',required=false)=>`<label>${e(label)}<input name="${e(name)}" type="${type}" ${name==='semester'?'min="1" max="8" step="1"':''} ${required?'required':''}></label>`;
requireAuth(location.pathname.endsWith('super-admin-dashboard.html')?['super_admin']:['admin','super_admin']).then(profile=>{actor=profile;return render();}).catch(error=>{errorState(content,error);document.body.classList.add('workspace-ready');});
async function render() {
  content.innerHTML=`<div class="banner">${isEmulator?'DEMO EMULATOR — new accounts use DemoPassword123! locally.':'College accounts use secure Firebase sign-in; passwords are never stored in application records.'}</div>
  <nav>${actor.role==='super_admin'?'<a href="super-admin-dashboard.html#institution-settings">Institution Settings</a> · <a href="admin-dashboard.html">College Administration</a> · ':''}<a href="academic.html">Classes & marks</a></nav>
  ${actor.role==='super_admin'?`<div class="card"><h2>Institution Settings</h2><p>Manage institution-wide email settings.</p><form id="policyForm">${field('allowedDomains','Allowed college domains (comma-separated)','text',true)}<p>Only email addresses from these domains can be used to create institutional accounts.</p><button class="btn-primary">Save Institution Settings</button></form><p id="policyStatus" role="status"></p></div>`:''}
  <div class="card"><h2>Manage College Accounts</h2><p>Add and manage student, faculty and staff login accounts.</p><form id="accountForm"><label>Role<select name="role">${ROLES.filter(r=>actor.role==='super_admin'||['student','subject_faculty','mentor'].includes(r)).map(r=>`<option value="${e(r)}">${e(roleLabel(r))}</option>`).join('')}</select></label>${field('name','Name','text',true)}${field('collegeEmail','College email','email',true)}${field('phone','Phone')}${field('department','Department','text',true)}${field('facultyId','Employee / Faculty ID (staff)')}${field('usn','USN (students)')}${field('semester','Semester (students)','number')}${field('section','Section (students)')}${field('scheme','Scheme (students)')}<label>Mentor college email (students)<input name="mentorEmail" type="email" list="mentorOptions"></label><datalist id="mentorOptions"></datalist>${field('mentorEmployeeId','Mentor employee ID (alternative)')}</form><div class="provision-actions"><button type="submit" form="accountForm" id="validateAccountBtn" class="btn-primary">Validate account</button><button type="button" id="provisionBtn" class="btn-primary" disabled>Confirm & create account</button></div><div id="accountPreview"></div><p id="accountStatus" role="status"></p></div>
  ${collegeImportHTML()}
  <div id="exitManagement"></div><div class="card"><h2>Find institutional account</h2><label>Search by<select id="searchField"><option value="email">College email</option><option value="usn">USN</option><option value="facultyId">Employee / Faculty ID</option></select></label><label>Exact value<input id="searchValue"></label><button id="searchBtn" class="btn-sm">Find account</button><div id="searchResults"></div></div>`;
  exitManager=mountExitManagement(document.getElementById('exitManagement'),actor);
  if(actor.role==='super_admin')loadMasters().then(m=>mountInstitutionServices(document.getElementById('policyForm').closest('.card'),m,api)).catch(error=>document.getElementById('policyStatus').textContent=error.message);
  if(document.getElementById('policyForm'))document.getElementById('policyForm').onsubmit=event=>{event.preventDefault();busy(event.target.querySelector('button'),async()=>{
    const data=Object.fromEntries(new FormData(event.target));for(const key of ['allowedDomains']) data[key]=data[key].split(',').map(v=>v.trim()).filter(Boolean);
    await api('savePolicy',{policy:data});document.getElementById('policyStatus').textContent='Policy saved.';
  });};
  let accountRow,accountRequestId;
  document.getElementById('accountForm').oninput=()=>{accountRow=null;document.getElementById('provisionBtn').disabled=true;};
  document.getElementById('accountForm').onsubmit=event=>{event.preventDefault();busy(document.getElementById('validateAccountBtn'),async()=>{
    const checked=(await api('previewAccounts',{rows:[Object.fromEntries(new FormData(event.target))]})).rows[0];
    document.getElementById('accountPreview').innerHTML=`<p>${e(checked.status)}: ${e(checked.error || checked.warnings?.join(' ') || 'Ready to create account.')}</p>`;
    accountRow=checked.status==='ERROR'?null:checked.row;accountRequestId=crypto.randomUUID();document.getElementById('provisionBtn').disabled=!accountRow;
  });};
  document.getElementById('provisionBtn').onclick=async event=>{await busy(event.target,async()=>{
    if(!accountRow) throw new Error('Validate the account first.');
    const result=await api('provision',{row:accountRow,requestId:accountRequestId});
    document.getElementById('accountStatus').textContent=`Created ${result.email}; ${result.subjectsMapped} subjects mapped; activation: ${result.activation}.${result.demoPassword?' Emulator password: '+result.demoPassword:''}${result.warning?' '+result.warning:''}`;
    accountRow=null;
  });event.target.disabled=!accountRow;};
  mountCollegeImport();
  document.getElementById('searchBtn').onclick=event=>busy(event.target,async()=>{
    const result=await api('directory',{field:document.getElementById('searchField').value,value:document.getElementById('searchValue').value});
    document.getElementById('searchResults').innerHTML=result.rows.map(r=>`<div class="row"><span>${e(r.name)} · ${e(r.email)} · ${e(roleLabel(r.role))}<br>${e(r.usn || r.facultyId)}<br>Status: ${e(r.accountStatus || "active")}</span>${!['admin','super_admin'].includes(r.role)?`<button class="btn-sm" data-remove-account="${e(r.uid)}">${r.accountStatus==="inactive"?"View inactive account":"Deactivate Account"}</button>`:""}</div>`).join('') || 'No account found.';
    wireAccountRemoval(document.getElementById('searchResults'),async()=>{await exitManager.refresh();document.getElementById('searchBtn').click();});
  });
  try {
    const lazy=(node,load)=>{if(!node)return;let loaded=false;const observer=new IntersectionObserver(entries=>{if(!loaded&&entries.some(entry=>entry.isIntersecting)){loaded=true;observer.disconnect();load().catch(error=>{(document.getElementById('policyStatus')||document.getElementById('accountStatus')).textContent=error.message;});}});observer.observe(node);};
    lazy(document.getElementById('policyForm'),async()=>{const policy=await api('policy'),form=document.getElementById('policyForm');form.elements.allowedDomains.value=(policy.allowedDomains||[]).join(', ');if(isEmulator&&!form.elements.allowedDomains.value)form.elements.allowedDomains.value='demo.test';});
    const mentorLoad=async()=>{const mentors=await (await import('./api.js')).apiFetch('/api/administration/mentors');document.getElementById('mentorOptions').innerHTML=mentors.rows.map(m=>'<option value="'+e(m.email)+'">'+e(m.name)+' · '+e(m.facultyId)+'</option>').join('');};let mentorsLoaded=false;document.getElementById('accountForm').addEventListener('focusin',event=>{if(!mentorsLoaded&&['mentorEmail','mentorEmployeeId'].includes(event.target.name)){mentorsLoaded=true;mentorLoad().catch(error=>{mentorsLoaded=false;document.getElementById('accountStatus').textContent=error.message;});}});
    await mountDepartmentManagement(actor);const masters=await loadMasters(),current=actor.role==='admin'?actor.departmentId:sessionStorage.getItem('department-context:'+actor.uid)||'';mountProvisioningForms(actor,masters,current);mountWorkflowOversight(content,actor,masters,current);mountSuperWorkspace(content,actor);
  } catch(error) {if(document.body.classList.contains('super-admin-page'))throw error;(document.getElementById('policyStatus')||document.getElementById('accountStatus')).textContent=`Account management unavailable: ${error.message}. Start the Functions emulator or deploy the backend. Please retry when the backend is available.`;}
}
function showPreview() {
  const counts=status=>preview.filter(r=>r.status===status).length;
  document.getElementById('importPreview').innerHTML=`<p>${preview.length} rows uploaded · ${counts('VALID')} valid · ${counts('WARNING')} warnings · ${preview.filter(r=>r.duplicate).length} duplicate rows · ${counts('ERROR')} error rows</p><div class="table-scroll"><table class="${document.getElementById('importType').value==='teachers'?'teacher-preview':''}"><thead><tr><th>#</th><th>Name / subject</th><th>Email / teacher</th><th>${document.getElementById('importType').value==='teachers'?'Employee ID / role':'Section'}</th><th>Department</th><th>Status</th><th>Details</th></tr></thead><tbody>${preview.slice(previewPage*50,(previewPage+1)*50).map(r=>`<tr><td>${r.index+1}</td><td>${e(r.row.name || r.row.subjectName)}</td><td>${e(r.row.collegeEmail || r.row.teacherEmail)}</td><td>${document.getElementById('importType').value==='teachers'?e(r.row.employeeId)+' / '+e(roleLabel(r.row.role)):e(r.row.section)}</td><td>${e(departmentLabel(r.row.department))}</td><td>${e(r.status)}</td><td>${e(r.error || r.warnings?.join(' ') || 'Ready')}${r.inactiveUid?`<br><button class="btn-sm" data-reactivate-account="${e(r.inactiveUid)}" data-kind="${document.getElementById('importType').value==='students'?'student':'faculty'}">Reactivate existing account</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
  wireAccountReactivation(document.getElementById('importPreview'),async()=>{await exitManager.refresh();document.getElementById('previewBtn').click();});
  document.getElementById('previewPrevious').hidden=previewPage===0;document.getElementById('previewNext').hidden=(previewPage+1)*50>=preview.length;
}
