import {requireAuth,wireLogout} from './auth.js';
import {functions,isEmulator} from './firebase-config.js';
import {httpsCallable} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js';
import {parseCSV} from './csv.js';
import {page} from './academic.js';
import {escapeHtml as e,busy,errorState} from './ui.js';
import {ROLES} from './admin-data.js';
import {initThemeToggle} from './theme.js';
const callable=httpsCallable(functions,'institutionalAdmin',{timeout:540000});
const api=async(action,data={})=>(await callable({action,...data})).data;
const content=document.getElementById('content');
wireLogout();initThemeToggle();
let preview=[],results=[],jobId='',previewPage=0;
const field=(name,label,type='text',required=false)=>`<label>${e(label)}<input name="${e(name)}" type="${type}" ${required?'required':''}></label>`;
requireAuth(['admin']).then(render).catch(error=>errorState(content,error));
async function render() {
  content.innerHTML=`<div class="banner">${isEmulator?'DEMO EMULATOR — new accounts use DemoPassword123! locally.':'College accounts receive activation email; passwords are never stored in Firestore.'}</div>
  <nav><a href="advanced-admin.html">Advanced record editing & legacy compatibility</a> · <a href="academic.html">Classes & marks</a></nav>
  <div class="card"><h2>Institution policy</h2><form id="policyForm">${field('allowedDomains','Allowed college domains (comma-separated)','text',true)}${field('departments','Departments (comma-separated)','text',true)}${field('sections','Sections (comma-separated)','text',true)}${field('smtpHost','Activation SMTP host')}${field('smtpPort','SMTP port (465 or 587)','number')}${field('smtpUser','SMTP username')}${field('mailFrom','Activation sender email','email')}<p>Configure the SMTP password in server Secret Manager; never enter it here.</p><button class="btn-primary">Save institution policy</button></form><p id="policyStatus" role="status"></p></div>
  <div class="card"><h2>Provision college account</h2><form id="accountForm"><label>Role<select name="role">${ROLES.map(r=>`<option>${r}</option>`).join('')}</select></label>${field('name','Name','text',true)}${field('collegeEmail','College email','email',true)}${field('phone','Phone')}${field('department','Department','text',true)}${field('facultyId','Employee / Faculty ID (staff)')}${field('usn','USN (students)')}${field('semester','Semester (students)','number')}${field('section','Section (students)')}${field('scheme','Scheme (students)')}<label>Mentor college email (students)<input name="mentorEmail" type="email" list="mentorOptions"></label><datalist id="mentorOptions"></datalist>${field('mentorEmployeeId','Mentor employee ID (alternative)')}</form><div class="provision-actions"><button type="submit" form="accountForm" id="validateAccountBtn" class="btn-primary">Validate account</button><button type="button" id="provisionBtn" class="btn-primary" disabled>Confirm & provision account</button></div><div id="accountPreview"></div><p id="accountStatus" role="status"></p></div>
  <div class="card"><h2>Bulk CSV import</h2><label>Import type<select id="importType"><option value="students">Students — create accounts and enroll automatically</option><option value="teachers">Teachers / Faculty</option><option value="offerings">Subjects / offerings — resolve existing teachers</option></select></label><p><a href="templates/student-import.csv" download="student-import.csv">Student template</a> · <a href="templates/teacher-import.csv" download="teacher-import.csv">Teacher template</a> · <a href="templates/offering-import.csv" download="offering-import.csv">Offering template</a> · <a href="templates/ise-5c-2022-confirmed.csv" download="ise-5c-2022-confirmed.csv">Confirmed ISE 5C source</a></p><input id="importFile" type="file" accept=".csv"><button id="previewBtn" class="btn-sm">Validate & preview CSV</button><div id="importPreview"></div><button id="previewPrevious" class="btn-sm" hidden>Previous preview rows</button><button id="previewNext" class="btn-sm" hidden>Next preview rows</button><label><input id="acceptWarnings" type="checkbox" style="width:auto"> I reviewed the warnings and will import only VALID / WARNING rows.</label><button id="importBtn" class="btn-primary" disabled>Confirm & import validated rows</button><p id="importProgress" role="status" aria-live="polite"></p><div id="importResults"></div><button id="downloadReport" class="btn-sm" disabled>Download result report</button></div>
  <div class="card"><h2>Find institutional account</h2><label>Search by<select id="searchField"><option value="email">College email</option><option value="usn">USN</option><option value="facultyId">Employee / Faculty ID</option></select></label><label>Exact value<input id="searchValue"></label><button id="searchBtn" class="btn-sm">Find account</button><div id="searchResults"></div></div>`;
  document.getElementById('policyForm').onsubmit=event=>{event.preventDefault();busy(event.target.querySelector('button'),async()=>{
    const data=Object.fromEntries(new FormData(event.target));for(const key of ['allowedDomains','departments','sections']) data[key]=data[key].split(',').map(v=>v.trim()).filter(Boolean);
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
  const resetPreview=()=>{preview=[];results=[];document.getElementById('importBtn').disabled=true;document.getElementById('acceptWarnings').checked=false;document.getElementById('importPreview').textContent='';document.getElementById('downloadReport').disabled=true;};
  document.getElementById('importFile').onchange=resetPreview;document.getElementById('importType').onchange=resetPreview;
  document.getElementById('previewBtn').onclick=event=>busy(event.target,async()=>{
    resetPreview();const file=document.getElementById('importFile').files[0];if(!file) throw new Error('Choose a CSV file.');if(file.size>2*1024*1024) throw new Error('CSV must be at most 2 MB.');
    const type=document.getElementById('importType').value;
    const rows=parseCSV(await file.text(),type==='students'?['name','usn','collegeEmail','phone','department','semester','section','scheme']:type==='teachers'?['name','collegeEmail','phone','department','employeeId','role']:['department','scheme','semester','section','subjectCode','subjectName','teacherEmail','credits','components']);
    if(!rows.length || rows.length>2000) throw new Error('Upload 1–2000 rows; split larger files.');
    jobId=crypto.randomUUID();const seen=new Map();
    for(let start=0;start<rows.length;start+=100) {
      document.getElementById('importProgress').textContent=`Validating ${start+1}–${Math.min(start+100,rows.length)} / ${rows.length}…`;
      const chunk=await api(type==='students'?'previewAccounts':type==='teachers'?'previewTeachers':'previewOfferings',{rows:rows.slice(start,start+100)});
      for(const checked of chunk.rows) {
        checked.index+=start;
        const keys=type!=='offerings'?['collegeEmail',type==='teachers'?'employeeId':'usn'].map(k=>`${k}:${String(checked.row[k] || '').trim().toLowerCase()}`):[JSON.stringify([checked.row.department,checked.row.scheme,checked.row.semester,checked.row.section,checked.row.subjectCode])];
        for(const key of keys.filter(k=>type!=='offerings'?!k.endsWith(':'):Boolean(checked.row.subjectCode))) {
          if(seen.has(key)) {checked.status='ERROR';checked.error='Duplicate identity/offering in this CSV.';checked.duplicate=true;const earlier=preview[seen.get(key)];earlier.status='ERROR';earlier.error=checked.error;earlier.duplicate=true;}
          else seen.set(key,checked.index);
        }
        preview.push(checked);
      }
    }
    previewPage=0;showPreview();document.getElementById('importProgress').textContent=type==='offerings' && preview.some(r=>r.status==='ERROR')?'Preview ready. Offerings import blocked: fix every invalid row, including missing teacher accounts, then validate again.':'Preview ready. Review before confirming.';
  });
  document.getElementById('previewPrevious').onclick=()=>{previewPage--;showPreview();};document.getElementById('previewNext').onclick=()=>{previewPage++;showPreview();};
  document.getElementById('acceptWarnings').onchange=()=>{document.getElementById('importBtn').disabled=!document.getElementById('acceptWarnings').checked || !preview.some(r=>r.status!=='ERROR') || (document.getElementById('importType').value==='offerings' && preview.some(r=>r.status==='ERROR'));};
  document.getElementById('importBtn').onclick=event=>busy(event.target,async()=>{
    const type=document.getElementById('importType').value,valid=preview.filter(r=>r.status!=='ERROR');
    if(!valid.length || !document.getElementById('acceptWarnings').checked) throw new Error('Review and confirm validated rows.');
    if(type==='offerings' && preview.some(r=>r.status==='ERROR')) throw new Error('Fix all invalid offering rows and revalidate; no partial offering set will be imported.');
    const controls=['importFile','importType','previewBtn','acceptWarnings'];controls.forEach(id=>document.getElementById(id).disabled=true);results=[];
    try {
      for(const checked of valid) {
        const row=checked.row;
        try {
          const result=type==='students'?await api('provision',{row,requestId:`${jobId}-${checked.index}`}):type==='teachers'?await api('importTeacher',{row}):await api('importOffering',{row});results.push({...row,...result,error:''});
          if(type==='offerings' && result.mappingErrors?.length)results.at(-1).error=result.mappingErrors.map(r=>`${r.uid}: ${r.error}`).join('; ');
        } catch(error) {results.push({...row,error:error.message,accountCreated:false});}
        document.getElementById('importProgress').textContent=`Processed ${results.length}/${valid.length}; ${results.filter(r=>r.error).length} errors.`;
      }
      results.push(...preview.filter(r=>r.status==='ERROR').map(r=>({...r.row,error:r.error,accountCreated:false})));
      document.getElementById('importProgress').textContent=`${results.filter(r=>!r.error).length}/${preview.length} rows completed; ${results.filter(r=>r.error).length} failed or skipped.`;
      document.getElementById('importResults').innerHTML=results.map(r=>`<p>${e(r.name || r.subjectName)} · ${e(r.usn || r.employeeId || r.subjectCode)} · ${e(r.email || r.collegeEmail || r.teacherEmail)} · ${e(r.error || r.warning || (type==='teachers'?(r.accountUpdated?'Teacher updated':'Teacher created'):type==='offerings'?r.studentsMapped+' / '+r.studentsMatched+' matching students mapped':r.subjectsMapped !== undefined ? r.subjectsMapped + ' subjects mapped' : 'Complete'))} ${r.activation?'· activation '+e(r.activation):''}</p>`).join('');document.getElementById('downloadReport').disabled=false;
    } finally {controls.forEach(id=>document.getElementById(id).disabled=false);}
  });
  document.getElementById('downloadReport').onclick=()=>{
    const headers=['name','usn','email','section','accountCreated','academicMappingCreated','mentorMapped','subjectsMapped','activation','error','warning','employeeId','role','uid','accountUpdated','studentsMatched','studentsMapped'],quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
    const csv=[headers.join(','),...results.map(r=>headers.map(k=>quote(r[k])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='institutional-import-results.csv';a.click();URL.revokeObjectURL(url);
  };
  document.getElementById('searchBtn').onclick=event=>busy(event.target,async()=>{
    const result=await api('directory',{field:document.getElementById('searchField').value,value:document.getElementById('searchValue').value});
    document.getElementById('searchResults').innerHTML=result.rows.map(r=>`<div class="row"><span>${e(r.name)} · ${e(r.email)} · ${e(r.role)}<br>${e(r.usn || r.facultyId)} · internal UID ${e(r.uid)}</span><button class="btn-sm retry-activation" data-uid="${e(r.uid)}">Retry activation email</button></div>`).join('') || 'No account found.';
    document.querySelectorAll('.retry-activation').forEach(b=>b.onclick=()=>busy(b,async()=>{const delivery=await api('retryActivation',{uid:b.dataset.uid});alert(delivery.warning || `Activation: ${delivery.activation}`);}));
  });
  try {
    const policy=await api('policy'),form=document.getElementById('policyForm');for(const key of ['allowedDomains','departments','sections']) form.elements[key].value=policy[key].join(', ');for(const key of ['smtpHost','smtpPort','smtpUser','mailFrom']) form.elements[key].value=policy[key] || '';
    if(isEmulator && !form.elements.allowedDomains.value) form.elements.allowedDomains.value='demo.test';
    const mentors=await page('users',[['role','==','mentor']],null,100);document.getElementById('mentorOptions').innerHTML=mentors.rows.map(m=>`<option value="${e(m.email)}">${e(m.name)} · ${e(m.facultyId)}</option>`).join('');
  } catch(error) {document.getElementById('policyStatus').textContent=`Provisioning backend unavailable: ${error.message}. Start the Functions emulator or deploy the backend. Existing workflows remain available through Advanced record editing.`;}
}
function showPreview() {
  const counts=status=>preview.filter(r=>r.status===status).length;
  document.getElementById('importPreview').innerHTML=`<p>${preview.length} rows uploaded · ${counts('VALID')} valid · ${counts('WARNING')} warnings · ${preview.filter(r=>r.duplicate).length} duplicate rows · ${counts('ERROR')} error rows</p><div class="table-scroll"><table class="${document.getElementById('importType').value==='teachers'?'teacher-preview':''}"><thead><tr><th>CSV row</th><th>Name / subject</th><th>Email / teacher</th><th>${document.getElementById('importType').value==='teachers'?'Employee ID / role':'Section'}</th><th>Status</th><th>Details</th></tr></thead><tbody>${preview.slice(previewPage*50,(previewPage+1)*50).map(r=>`<tr><td>${r.index+2}</td><td>${e(r.row.name || r.row.subjectName)}</td><td>${e(r.row.collegeEmail || r.row.teacherEmail)}</td><td>${document.getElementById('importType').value==='teachers'?e(r.row.employeeId)+' / '+e(r.row.role):e(r.row.section)}</td><td>${e(r.status)}</td><td>${e(r.error || r.warnings?.join(' ') || 'Ready')}</td></tr>`).join('')}</tbody></table></div>`;
  document.getElementById('previewPrevious').hidden=previewPage===0;document.getElementById('previewNext').hidden=(previewPage+1)*50>=preview.length;
}
