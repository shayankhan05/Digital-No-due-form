import {wireAccountReactivation} from './account-removal.js';
import {parseCollegeCSV} from './college-csv.js';
import {post,apiFetch} from './api.js';
import {escapeHtml as e,busy} from './ui.js';
import {collegeImportFormats,collegeTemplate} from './college-import-formats.js';
import {loadMasters} from './master-data.js';
import {auth} from './firebase-config.js';
export function mountCollegeImport(){
 const $=id=>document.getElementById(id);let preview=[],jobId=null,page=0,results=[],running=false,studentSummary=null,requiresReactivation=false,jobState='ready',retryRevision=0;
 const defaultImportLabel=$('importBtn').textContent;const reset=()=>{$('importBtn').textContent=defaultImportLabel;preview=[];jobId=null;results=[];studentSummary=null;requiresReactivation=false;jobState='ready';retryRevision=0;$('reactivateStudents').checked=false;$('studentReactivateOption').hidden=true;$('importPreview').replaceChildren();$('importResults').replaceChildren();$('acceptWarnings').checked=false;$('importBtn').disabled=true;$('downloadReport').disabled=true;$('importProgress').textContent='';};
 const studentMode=()=>$('importType').value==='students';
 const tracksJob=()=>studentMode()||$('importType').value==='teaching';
 const studentTotals=()=>studentSummary?`<p>New: ${studentSummary.new} · Existing: ${studentSummary.existing} · Inactive: ${studentSummary.inactive} · Conflicts: ${studentSummary.conflicts}</p><p>Existing mentor changes: ${studentSummary.mentorChanges} · Existing section changes: ${studentSummary.sectionChanges} · Academic changes deferred: ${studentSummary.deferred}</p>`:'';
 const studentDetail={NEW:'Create student',EXISTING:'Safe to update existing account',INACTIVE:'Safe to reactivate and reconcile'};
 const draw=()=>{$('importPreview').innerHTML=`<p>${preview.length} rows Â· ${preview.filter(r=>r.status==='VALID').length} valid Â· ${preview.filter(r=>r.status==='WARNING').length} warnings Â· ${preview.filter(r=>r.status==='ERROR').length} error rows Â· ${preview.filter(r=>r.duplicate).length} duplicates</p>${studentTotals()}<div class="table-scroll" tabindex="0" role="region" aria-label="Import preview"><table${tracksJob()?' class="teaching-preview-table"':''}><thead><tr><th>#</th><th>Name / subject</th><th>Email / teacher</th><th>USN / employee / section</th><th>Status</th><th>Details</th></tr></thead><tbody>${preview.slice(page*50,(page+1)*50).map(r=>`<tr><td>${r.index+1}</td><td>${e(r.row.name||r.row.subjectName)}</td><td>${e(r.row.collegeEmail||r.row.teacherEmail)}</td><td>${e(r.row.usn||r.row.employeeId||r.row.section)}${r.row.auid?' Â· AUID: '+e(r.row.auid):''}</td><td>${e(r.classification||r.status)}</td><td>${e(r.error||[studentDetail[r.classification],...(r.warnings||[])].filter(Boolean).join('. ')||'Ready')}${r.inactiveUid?`<br><button class="btn-sm" data-reactivate-account="${e(r.inactiveUid)}" data-kind="${$('importType').value==='students'?'student':'faculty'}">Reactivate existing account</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;wireAccountReactivation($('importPreview'),async()=>{$('previewBtn').click();});$('previewPrevious').hidden=page===0;$('previewNext').hidden=(page+1)*50>=preview.length;};
 const controls=['importFile','importType','previewBtn','acceptWarnings','reactivateStudents','keepStudentPlacement'];
 const storageKey=()=>auth.currentUser&&$('importType').value+'-import:'+auth.currentUser.uid+':'+(sessionStorage.getItem('department-context:'+auth.currentUser.uid)||'');
 const remember=id=>{const key=storageKey();if(key){if(id)sessionStorage.setItem(key,id);else sessionStorage.removeItem(key);}};
 const setRunning=value=>{
  running=value;$('collegeImport').dataset.running=String(value);
  controls.forEach(id=>$(id).disabled=value);
 };
 const importButton=()=>{
  $('importBtn').disabled=running||!jobId||!$('acceptWarnings').checked||jobState==='completed'||requiresReactivation&&!$('reactivateStudents').checked;
  $('importBtn').textContent=jobState==='interrupted'?'Safe to resume':jobState==='failed'?'Retry failed rows':requiresReactivation?'Reactivate & reconcile':defaultImportLabel;
 };
 const showImportResult=outcome=>{
  results=outcome.results;
  const label=outcome.status==='completed'?'Completed':'Failed';
  $('importProgress').textContent=label+' · '+(outcome.total-outcome.errors)+'/'+outcome.total+' rows completed · '+outcome.errors+' failed or skipped.';
  $('importResults').innerHTML=`<p>Rows read: ${outcome.total} · Created: ${outcome.created} · Existing / safely updated: ${outcome.existing} · Failed: ${outcome.errors}</p>${studentMode()?`<p>Reactivated: ${results.filter(r=>r.reactivated&&!r.error).length} · Mentor mappings: ${outcome.mentorMappings}/${outcome.total} · Subject mappings: ${outcome.subjectsMapped}</p>`:''}${results.filter(r=>r.error).slice(0,50).map(r=>`<p>CSV row ${r.index+2} · ${e(r.identifier)}: ${e(r.error)}</p>`).join('')}`;
  $('downloadReport').disabled=false;
 };
 const requestOptions=()=>({signal:AbortSignal.timeout(12000)});
 async function trackImport(start=false,outcome=null){
  if(running||!jobId)return;
  setRunning(true);
  importButton();
  const retryFailed=jobState==='failed';
  try{
   if(start){
    $('importProgress').textContent='Submitting the import…';
    remember(jobId);
    try{
     outcome=await apiFetch('/api/college-import/confirm',{...requestOptions(),method:'POST',body:JSON.stringify({jobId,confirmation:true,background:true,retryFailed,retryRevision,reactivateStudents:$('reactivateStudents').checked})});
    }catch(error){
     if(['permission-denied','unauthenticated','invalid-argument','department/inactive'].includes(error.code))throw error;
     // A response can disappear after the server acquires the job. Read its
     // status before offering any retry.
    }
   }
   while(true){
    if(!outcome){
     try{outcome=await apiFetch('/api/college-import/jobs/'+jobId,requestOptions());}
     catch(error){
      if(['permission-denied','unauthenticated','invalid-argument','department/inactive'].includes(error.code))throw error;
      $('importProgress').textContent='Connection interrupted · Checking import status…';
      await new Promise(resolve=>setTimeout(resolve,3000));
      continue;
     }
    }
    jobId=outcome.jobId;
    remember(jobId);
    jobState=outcome.status;
    retryRevision=outcome.retryRevision;
    requiresReactivation=outcome.requiresReactivation===true;
    $('studentReactivateOption').hidden=!requiresReactivation;
    if(jobState==='queued'||jobState==='running'){
     const label=jobState==='queued'?'Queued':'Running';
     $('importProgress').textContent=`${label} · ${outcome.processed}/${outcome.total} rows processed. Import is still running in the background.`;
    }else{
     if(jobState==='completed'||jobState==='failed'){
      showImportResult(outcome);
      if(jobState==='completed')window.dispatchEvent(new Event('institution:masters-changed'));
     }else if(outcome.safeToResume){
      $('importProgress').textContent=`Interrupted · ${outcome.processed}/${outcome.total} rows saved. Safe to resume.`;
     }else{
      if(!preview.length)$('acceptWarnings').checked=false;
      $('importProgress').textContent='Preview ready. Review relationships and confirm the entire file.';
     }
     return;
    }
    outcome=null;
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
  }catch(error){
   $('importProgress').textContent=error.message;
   remember(null);jobId=null;
  }finally{setRunning(false);importButton();}
 }
 const restoreImport=async()=>{
  if(!tracksJob())return;
  const key=storageKey();
  jobId=key&&sessionStorage.getItem(key);
  if(jobId){$('acceptWarnings').checked=true;void trackImport();return;}
  try{
   const recent=await apiFetch('/api/college-import/jobs/latest'+(studentMode()?'?type=students':''),requestOptions());
   if(!recent||recent.status==='ready'||storageKey()!==key||!tracksJob()||$('importFile').files.length||jobId||running)return;
   jobId=recent.jobId;
   $('acceptWarnings').checked=true;
   void trackImport(false,recent);
  }catch{
   // Recent history is optional when there is no saved job in this tab.
  }
 };
 let chosen;const choose=type=>{if(chosen===type)return;chosen=type;$('importType').value=type;reset();$('importFile').value='';$('selectedImportDescription').textContent=collegeImportFormats[type].description;$('studentImportOptions').hidden=!studentMode();document.querySelectorAll('[data-choose-import]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.chooseImport===type)));document.querySelectorAll('[data-import-category]').forEach(card=>card.classList.toggle('selected',card.dataset.importCategory===type));void restoreImport();};
 document.querySelectorAll('[data-choose-import]').forEach(b=>b.onclick=()=>{if(running)return;choose(b.dataset.chooseImport);$('importFile').click();});
 document.querySelectorAll('[data-import-template]').forEach(link=>link.onclick=async event=>{event.preventDefault();const masters=await loadMasters(),id=sessionStorage.getItem('department-context:'+auth.currentUser.uid),department=masters.departments.find(d=>d._id===id)?.code||(masters.departments.length===1?masters.departments[0].code:null)||'DEPT',type=link.dataset.importTemplate,url=URL.createObjectURL(new Blob([collegeTemplate(type,department)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=collegeImportFormats[type].file;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 window.addEventListener('college:choose-import',event=>{if(!running)choose(event.detail);});choose($('importType').value);
 $('importFile').onchange=()=>{if(tracksJob())remember(null);reset();};$('importType').onchange=()=>choose($('importType').value);$('previewPrevious').onclick=()=>{page--;draw();};$('previewNext').onclick=()=>{page++;draw();};
 $('previewBtn').onclick=event=>busy(event.target,async()=>{reset();const file=$('importFile').files[0];if(!file)throw Error('Choose a CSV file.');if(file.size>700000)throw Error('CSV must be smaller than 700 KB.');const rows=parseCollegeCSV(await file.text(),$('importType').value);if(!rows.length||rows.length>2000)throw Error('Import 1â€“2000 rows.');$('importProgress').textContent='Validating all identities and relationshipsâ€¦';const result=await post('/api/college-import/preview',{type:$('importType').value,rows,requestId:crypto.randomUUID(),background:tracksJob(),reconcileStudents:studentMode(),keepExistingPlacement:$('keepStudentPlacement').checked});preview=result.rows;jobId=result.jobId;studentSummary=result.studentSummary;requiresReactivation=!!studentSummary?.inactive;$('studentReactivateOption').hidden=!requiresReactivation;page=0;draw();$('importProgress').textContent=result.errors?'Import blocked. Fix every invalid row and validate again; no accounts have been imported.':'Preview ready. Review relationships and confirm the entire file.';if(jobId&&tracksJob())void trackImport();});
 $('acceptWarnings').onchange=()=>{
  if(tracksJob())importButton();
  else $('importBtn').disabled=running||!jobId||!$('acceptWarnings').checked;
 };
 $('reactivateStudents').onchange=importButton;
 $('keepStudentPlacement').onchange=reset;
 $('importBtn').onclick=async event=>{if(running||!jobId||!$('acceptWarnings').checked)return;if(tracksJob())return trackImport(true);running=true;$('collegeImport').dataset.running='true';let interrupted=false;const controls=['importFile','importType','previewBtn','acceptWarnings'];controls.forEach(id=>$(id).disabled=true);await busy(event.target,async()=>{try{let outcome;do{outcome=await post('/api/college-import/confirm',{jobId,confirmation:true,retryFailed:results.some(r=>r.error)});$('importProgress').textContent=`Processed ${outcome.processed}/${outcome.total} Â· Created ${outcome.created} Â· Existing ${outcome.existing} Â· Errors ${outcome.errors}`;}while(outcome.state!=='complete');results=outcome.results;$('importProgress').textContent=`${outcome.total-outcome.errors}/${outcome.total} rows completed; ${outcome.errors} failed or skipped. Created: ${outcome.created}; Existing: ${outcome.existing}.`;$('importResults').innerHTML=`<p>Rows read: ${outcome.total} Â· Created: ${outcome.created} Â· Existing / safely updated: ${outcome.existing} Â· Failed: ${outcome.errors}</p>${$('importType').value==='students'?`<p>Mentor mappings: ${outcome.mentorMappings}/${outcome.total} Â· Subject mappings: ${outcome.subjectsMapped}</p>`:''}${results.filter(r=>r.error).slice(0,50).map(r=>`<p>CSV row ${r.index+2} Â· ${e(r.identifier)}${r.auid?' Â· AUID: '+e(r.auid):''}: ${e(r.error)}</p>`).join('')}`;$('downloadReport').disabled=false;}catch(error){interrupted=true;throw error;}finally{running=false;$('collegeImport').dataset.running='false';controls.forEach(id=>$(id).disabled=false);}});event.target.disabled=interrupted?false:!results.some(r=>r.error);if(interrupted)event.target.textContent='Resume interrupted import';else if(results.some(r=>r.error))event.target.textContent='Retry failed rows';};
 $('downloadReport').onclick=()=>{const fields=['index','name','identifier',...($('importType').value==='students'?['auid']:[]),'uid','accountCreated','accountUpdated','mentorMapped','subjectsMapped','error'],quote=value=>'"'+String(value??'').replaceAll('"','""')+'"',csv=[fields.join(','),...results.map(r=>fields.map(f=>quote(f==='index'?r.index+2:r[f])).join(','))].join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='college-import-report.csv';a.click();URL.revokeObjectURL(url);};
 $('validateRelationships').onclick=event=>busy(event.target,async()=>{const result=await apiFetch('/api/administration/integrity');$('relationshipSummary').textContent=result.unexplained+' integrity issues Â· '+result.explainedLegacy.length+' documented legacy artifacts. '+result.issues.slice(0,10).map(r=>r.type+': '+r.id).join('; ');});
 $('showMentorMappings').onclick=event=>busy(event.target,async()=>{const {rows}=await apiFetch('/api/administration/mentors');$('mentorMappingSummary').innerHTML=rows.map(r=>`<p>${e(r.name)} Â· ${e(r.facultyId)} â€” ${r.mentees} mentees</p>`).join('')||'No eligible mentors configured.';});
}
