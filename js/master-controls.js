import {escapeHtml as e} from './ui.js';
export function mountAcademicSelects(form,masters){
 if(!form)return;
 const update=()=>{const dep=masters.departments.find(d=>d.code===form.elements.department?.value),rows={scheme:masters.schemes.filter(s=>s.status==='active'&&(!dep||(!dep.schemeIds?.length||dep.schemeIds.includes(s._id))&&(s.scope!=='department'||s.departmentIds?.includes(dep._id)))),section:(masters.sections||[]).filter(s=>s.status==='active'&&(!dep?.sections?.length||dep.sections.includes(s.code)))};
  for(const key of ['scheme','section']){const old=form.elements[key];if(!old)continue;const value=old.value,select=old.tagName==='SELECT'?old:document.createElement('select');select.name=key;select.innerHTML=`<option value="">Choose ${key}</option>`+rows[key].map(r=>`<option value="${e(r.code)}">${e(r.name)}</option>`).join('');select.value=value;if(select!==old)old.replaceWith(select);}
 };
 form.elements.department?.addEventListener('change',update);update();
}
