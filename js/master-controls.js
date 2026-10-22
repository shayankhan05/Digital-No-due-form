import {escapeHtml as e} from './ui.js';
export function mountAcademicSelects(form,masters){
 if(!form)return;
 const update=()=>{const dep=masters.departments.find(d=>d.code===form.elements.department?.value),rows={scheme:masters.schemes.filter(s=>s.status==='active'&&(!dep||(!dep.schemeIds?.length||dep.schemeIds.includes(s._id))&&(s.scope!=='department'||s.departmentIds?.includes(dep._id)))),section:(masters.sections||[]).filter(s=>s.status==='active'&&(!s.departmentId||s.departmentId===dep?._id)&&(!s.departmentIds?.length||s.departmentIds.includes(dep?._id))&&(!dep?.sections?.length||dep.sections.includes(s.code)))};
  for(const key of ['scheme','section']){const old=form.elements[key];if(!old)continue;const values=old.tagName==='SELECT'?[...old.selectedOptions].map(o=>o.value):[old.value],select=old.tagName==='SELECT'?old:document.createElement('select');select.name=key;select.required=old.required;select.disabled=old.disabled;select.innerHTML=`<option value="">Choose ${key}</option>`+rows[key].map(r=>`<option value="${e(r.code)}">${e(r.name)}</option>`).join('');if(select.multiple)select.querySelector('option[value=""]')?.remove();for(const option of select.options)option.selected=values.includes(option.value);if(select!==old)old.replaceWith(select);select.multiPicker?.refresh();}
 };
 form.elements.department?.addEventListener('change',update);window.addEventListener('institution:catalog-added',update);update();
}
