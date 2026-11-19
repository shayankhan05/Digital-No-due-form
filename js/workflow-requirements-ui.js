
import {apiFetch,post} from './api.js';
import {escapeHtml as e,busy} from './ui.js';
export function mountWorkflowRequirements(content,actor,departmentId){
 if(!['admin','super_admin'].includes(actor.role))return;
 let host=document.getElementById('departmentWorkflow');
 if(!host){host=document.createElement('section');host.id='departmentWorkflow';host.className='card';host.innerHTML='<h2>Workflow Setup</h2>';content.append(host);}
 const section=document.createElement('section');section.id='semesterWorkflowRequirements';host.append(section);
 if(!departmentId){section.textContent='Select a department and semester to review workflow requirements.';return;}
 let loaded=false;
 const load=async()=>{
  const result=await apiFetch('/api/administration/workflow-requirements'),selected=result.semesters.find(r=>r.semester===result.semester);
  section.innerHTML='<h3>Stage 1 requirements — '+e(result.department.name)+' · Semester '+result.semester+'</h3><p><strong>Common mandatory:</strong> applicable subject faculty, Library, Accounts and Sports. Subjects come from the student’s teaching assignments and enrollments.</p><p>Stage 1 approvals may happen in any order. All are required before Mentor → HOD → Office / final clearance.</p><div class="table-scroll"><table><thead><tr><th>Semester</th><th>Common mandatory</th><th>Physics Lab</th><th>Chemistry Lab</th><th>Configuration</th></tr></thead><tbody>'+result.semesters.map(r=>'<tr><td>'+r.semester+(r.semester===result.semester?' (selected)':'')+'</td><td>Subject faculty · Library · Accounts · Sports</td><td>'+(r.labs.physics_lab?'Required':'Not required')+'</td><td>'+(r.labs.chemistry_lab?'Required':'Not required')+'</td><td>'+e(r.source)+'</td></tr>').join('')+'</tbody></table></div><form id="semesterLabForm"><p>Optional / semester-specific labs for Semester '+result.semester+'. Defaults: both labs in Semesters 1–2; neither in Semesters 3–8.</p><label><input type="checkbox" class="action-confirmation" name="physics_lab"> Require Physics Lab</label><label><input type="checkbox" class="action-confirmation" name="chemistry_lab"> Require Chemistry Lab</label><p>Changes apply to new requests only. Existing requests retain their saved approvals and history; exceptions require administrator review.</p><button type="submit" class="btn-primary">Save semester requirements</button><p data-status role="status"></p></form>';
  const form=section.querySelector('form');for(const k of ['physics_lab','chemistry_lab'])form.elements[k].checked=selected.labs[k];
  form.onsubmit=event=>{event.preventDefault();busy(form.querySelector('button'),async()=>{try{await post('/api/administration/workflow-requirements',{semester:result.semester,physics_lab:form.elements.physics_lab.checked,chemistry_lab:form.elements.chemistry_lab.checked});await load();section.querySelector('[data-status]').textContent='Semester requirements saved. Existing requests were not changed.';}catch(error){form.querySelector('[data-status]').textContent=error.message;}});};
 };
 const show=()=>{if(['#workflow-setup','#departmentWorkflow'].includes(location.hash)&&!loaded){loaded=true;load().catch(error=>{loaded=false;section.textContent=error.message;});}};
 window.addEventListener('hashchange',show);show();
}
