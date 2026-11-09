import {apiFetch,post} from './api.js';
import {escapeHtml as e,busy} from './ui.js';

const endpoint='/api/administration/teaching-assignments';
const option=(value,label)=>'<option value="'+e(value)+'">'+e(label)+'</option>';
const labelFaculty=f=>f?f.name+' · '+(f.facultyId||'No employee ID'):'Unassigned';
const labelSubject=s=>s.code+' — '+s.name+' · '+s.scheme;
const pageSize=15;
function assignmentText(row){
 return row?e(row.code)+' — '+e(row.name)+' · Semester '+e(row.semester)+' · Section '+e(row.section)+' · '+e(row.teacher):'New assignment';
}
function openEditor({data,departmentId,offering,facultyId,refresh}){
 const dialog=document.createElement('dialog');dialog.className='card delete-review delete-review-cascade';
 const choices=[...data.subjects];
 if(offering&&!choices.some(s=>s.id===offering.subjectId))choices.push({id:offering.subjectId,code:offering.code,name:offering.name,scheme:offering.scheme,semester:offering.semester,unavailable:true});
 dialog.innerHTML='<h2>'+(offering?'Edit Teaching Assignment':'Add Teaching Assignment')+'</h2><form><label>Subject<select name="subjectId" required>'+option('','Choose subject')+choices.map(s=>option(s.id,labelSubject(s)+(s.unavailable?' (unavailable)':''))).join('')+'</select></label><label>Semester<select name="semester" required></select></label><label>Section<select name="section" required>'+option('','Choose section')+data.sections.map(s=>option(s,s)).join('')+'</select></label><label>Assigned faculty<select name="teacherId" required>'+option('','Choose faculty')+data.faculty.map(f=>option(f.id,labelFaculty(f))).join('')+'</select></label><div class="provision-actions"><button type="submit" class="btn-primary">Review changes</button>'+(offering?.active?'<button type="button" class="btn-sm" data-remove>Review removal</button>':'')+'<button type="button" class="btn-sm" data-close>Close</button></div></form><div data-impact aria-live="polite"></div><p role="status"></p>';
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.querySelector('[data-close]').onclick=()=>dialog.close();
 const form=dialog.querySelector('form'),controls=form.elements,impact=dialog.querySelector('[data-impact]'),status=dialog.querySelector('[role=status]');
 let revision=0;
 const semesters=()=>{const selected=choices.find(s=>s.id===controls.subjectId.value),used=data.offerings.filter(o=>o.subjectId===selected?.id).map(o=>Number(o.semester)),valid=selected?.semester?[Number(selected.semester)]:used.length?[...new Set(used)]:[1,2,3,4,5,6,7,8],old=controls.semester.value;controls.semester.innerHTML=option('','Choose semester')+valid.map(n=>option(n,n)).join('');controls.semester.value=valid.includes(Number(old))?old:valid.length===1?String(valid[0]):'';};
 controls.subjectId.value=offering?.subjectId||'';semesters();if(offering)controls.semester.value=offering.semester;
 controls.section.value=offering?.section||'';controls.teacherId.value=offering?.teacherId||facultyId||'';
 form.addEventListener('input',event=>{if(event.target===controls.subjectId)semesters();revision++;impact.replaceChildren();status.textContent='';});
 const review=(button,operation)=>busy(button,async()=>{
  const input={departmentId,operation,offeringId:offering?.id,...Object.fromEntries(new FormData(form))},run=++revision;
  impact.replaceChildren();status.textContent='Reviewing assignment…';
  try{
   const result=await post(endpoint+'/preview',input);if(run!==revision||!dialog.isConnected)return;
   status.textContent='';
   impact.innerHTML='<h3>Confirm impact</h3><p><strong>Current:</strong> '+assignmentText(result.previous)+'</p><p><strong>'+(operation==='remove'?'Deactivate':'Proposed')+':</strong> '+assignmentText(result.next)+'</p><p>'+result.enrollments+' enrollment records and '+result.marks+' marks records preserved. Assessment definitions and completed approvals are retained.</p>'+(result.matchingStudents?'<p>'+result.matchingStudents+' students in the destination cohort will be reviewed for enrollment.</p>':'')+(result.pending?'<p>'+result.pending+' pending clearance approvals reference the previous teacher.</p><label class="confirmation-row"><input type="checkbox" data-move> Move pending approvals to new faculty</label>':'')+'<button type="button" class="btn-primary" data-confirm>'+(operation==='remove'?'Confirm deactivation':'Confirm assignment')+'</button>';
   const confirm=impact.querySelector('[data-confirm]'),move=impact.querySelector('[data-move]');if(move){confirm.disabled=true;move.onchange=()=>confirm.disabled=!move.checked;}
   confirm.onclick=()=>busy(confirm,async()=>{if(run!==revision||move&&!move.checked)return;try{await post(endpoint+'/apply',{...input,fingerprint:result.fingerprint,confirmation:true,movePending:!!move?.checked});dialog.close();await refresh();}catch(err){status.textContent=err.message;impact.replaceChildren();}});
  }catch(err){if(run===revision)status.textContent=err.message;}
 });
 form.onsubmit=event=>{event.preventDefault();review(form.querySelector('[type=submit]'),offering?'edit':'add');};
 const remove=dialog.querySelector('[data-remove]');if(remove)remove.onclick=()=>review(remove,'remove');dialog.showModal();
}

function mountView(host,actor,masters,current,mode){
 const facultyMode=mode==='faculty';
 host.id=facultyMode?'facultyTeachingAssignments':'subjectTeachingAssignments';host.className='card';
 const departments=masters.departments.filter(d=>d.status==='active'&&(actor.role==='super_admin'?!current||d._id===current:d._id===actor.departmentId));
 host.innerHTML='<details><summary>'+ (facultyMode?'Teaching Assignments':'Subject Assignments')+'</summary><label>Department<select data-department>'+option('','Choose department')+departments.map(d=>option(d._id,d.name)).join('')+'</select></label><div data-filters></div><p data-status role="status"></p><div data-results></div><div class="provision-actions" data-pager hidden><button type="button" class="btn-sm" data-prev>Previous</button><span data-page></span><button type="button" class="btn-sm" data-next>Next</button></div></details>';
 const details=host.querySelector('details'),department=host.querySelector('[data-department]'),filters=host.querySelector('[data-filters]'),status=host.querySelector('[data-status]'),results=host.querySelector('[data-results]'),pager=host.querySelector('[data-pager]');
 department.value=current||actor.departmentId||'';department.disabled=departments.length===1;if(department.disabled&&!department.value)department.value=departments[0]._id;
 let data,page=1,request=0;
 const edit=(offering,facultyId)=>openEditor({data,departmentId:department.value,offering,facultyId,refresh:load});
 const draw=()=>{
  if(!data)return;
  const term=filters.querySelector('[name=term]').value.trim().toLowerCase(),semester=filters.querySelector('[name=semester]').value,section=filters.querySelector('[name=section]').value,subject=filters.querySelector('[name=subject]').value,teacher=filters.querySelector('[name=faculty]').value;
  const offerings=data.offerings.filter(o=>(!semester||String(o.semester)===semester)&&(!section||o.section===section)&&(!subject||o.subjectId===subject)&&(!teacher||o.teacherId===teacher));
  const match=(...values)=>values.some(value=>String(value??'').toLowerCase().includes(term));
  const rows=facultyMode?data.faculty.filter(f=>(!teacher||f.id===teacher)&&match(f.name,f.email,f.facultyId)&&(!(semester||section||subject)||offerings.some(o=>o.active&&o.teacherId===f.id))).sort((a,b)=>String(a.name).localeCompare(b.name)):offerings.filter(o=>match(o.name,o.code,o.teacher?.name,o.teacher?.facultyId,o.teacher?.email)).sort((a,b)=>String(a.scheme).localeCompare(b.scheme)||a.semester-b.semester||String(a.section).localeCompare(b.section)||String(a.code).localeCompare(b.code));
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.min(page,pages);
  results.replaceChildren();
  const visible=rows.slice((page-1)*pageSize,page*pageSize);
  if(!visible.length)results.textContent='No matching assignments.';
  if(facultyMode)for(const f of visible){
   const card=document.createElement('article');card.className='card';const own=offerings.filter(o=>o.active&&o.teacherId===f.id);
   card.innerHTML='<h3>'+e(f.name)+'</h3><p>'+e(f.facultyId)+' · '+e(f.email)+' · Active</p><details><summary>Edit Teaching Assignments ('+own.length+')</summary><ul>'+own.map(o=>'<li>'+e(o.code)+' — '+e(o.name)+' · '+e(o.scheme)+' · Semester '+e(o.semester)+' · Section '+e(o.section)+' · '+o.enrolled+' students <button type="button" class="btn-sm" data-edit="'+e(o.id)+'">Edit Assignment</button></li>').join('')+'</ul><button type="button" class="btn-sm" data-add>Add assignment for this faculty</button></details>';card.querySelector('[data-add]').onclick=()=>edit(null,f.id);results.append(card);
  }
  else if(visible.length){
   const groups=new Map();for(const o of visible){const key=o.scheme+' · Semester '+o.semester+' · Section '+o.section;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);}
   for(const [key,list] of groups){
    const group=document.createElement('section');group.innerHTML='<h3>'+e(department.selectedOptions[0]?.textContent)+' · '+e(key)+'</h3><div class="table-scroll" tabindex="0" role="region" aria-label="Subject assignments"><table><thead><tr><th>Subject</th><th>Assigned faculty</th><th>Students</th><th>Assessments</th><th>Status</th><th>Action</th></tr></thead><tbody>'+list.map(o=>'<tr><td><strong>'+e(o.code)+'</strong><br>'+e(o.name)+'</td><td>'+e(labelFaculty(o.teacher))+(o.teacher?.email?'<br>'+e(o.teacher.email):'')+'</td><td>'+o.enrolled+'</td><td>'+(o.components?o.components+' components':'Not configured')+'</td><td>'+(o.active?'Active':'Inactive')+'</td><td><button type="button" class="btn-sm" data-edit="'+e(o.id)+'">Edit Assignment</button></td></tr>').join('')+'</tbody></table></div>';results.append(group);
   }
  }
  for(const b of results.querySelectorAll('[data-edit]'))b.onclick=()=>edit(data.offerings.find(o=>o.id===b.dataset.edit));
  pager.hidden=pages<=1;pager.querySelector('[data-page]').textContent='Page '+page+' of '+pages;pager.querySelector('[data-prev]').disabled=page===1;pager.querySelector('[data-next]').disabled=page===pages;
 };
 async function load(){
  const run=++request,id=department.value;data=null;page=1;results.replaceChildren();filters.replaceChildren();pager.hidden=true;
  if(!id){status.textContent='Choose a department to see teaching assignments.';return;}
  status.textContent='Loading assignments…';
  try{
   const value=await apiFetch(endpoint+'?'+new URLSearchParams({departmentId:id}));if(run!==request)return;data=value;
   status.textContent=data.faculty.length+' faculty · '+data.offerings.filter(o=>o.active).length+' active offerings · '+data.students+' students';
   filters.innerHTML='<label>Search<input name="term" type="search" placeholder="Name, subject, employee ID or email"></label><label>Semester<select name="semester">'+option('','All semesters')+[1,2,3,4,5,6,7,8].map(n=>option(n,n)).join('')+'</select></label><label>Section<select name="section">'+option('','All sections')+data.sections.map(s=>option(s,s)).join('')+'</select></label><label>Subject<select name="subject">'+option('','All subjects')+data.subjects.map(s=>option(s.id,labelSubject(s))).join('')+'</select></label><label>Faculty<select name="faculty">'+option('','All faculty')+data.faculty.map(f=>option(f.id,labelFaculty(f))).join('')+'</select></label><button type="button" class="btn-sm" data-add>Add Teaching Assignment</button>';
   filters.querySelector('[data-add]').onclick=()=>edit(null);draw();
  }catch(err){if(run===request)status.textContent=err.message;}
 }
 details.ontoggle=()=>{if(details.open&&!data)load();};department.onchange=load;
 filters.oninput=()=>{page=1;draw();};pager.querySelector('[data-prev]').onclick=()=>{page--;draw();};pager.querySelector('[data-next]').onclick=()=>{page++;draw();};
}
export function mountTeachingAssignments(content,actor,masters,current){
 for(const mode of ['faculty','subject']){const host=document.createElement('section');content.append(host);mountView(host,actor,masters,current,mode);}
}
