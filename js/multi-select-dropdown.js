// Keep the original select as the form's value/validation source.
export function mountMultiSelectDropdown(select,label){
 const wrapper=document.createElement('div');wrapper.className='multi-picker';
 const caption=document.createElement('span');caption.className='multi-picker-label';caption.textContent=label;
 const details=document.createElement('details'),summary=document.createElement('summary'),selected=document.createElement('span'),arrow=document.createElement('span');
 selected.className='multi-picker-values';arrow.className='multi-picker-arrow';arrow.setAttribute('aria-hidden','true');summary.append(selected,arrow);details.append(summary);
 const panel=document.createElement('div');panel.className='multi-picker-panel';const options=document.createElement('div');options.className='multi-picker-options';panel.append(options);
 const done=document.createElement('button');done.type='button';done.className='btn-sm';done.textContent='Done';panel.append(done);details.append(panel);
 const error=document.createElement('p');error.className='multi-picker-error';error.id='multi-error-'+select.name;error.hidden=true;error.setAttribute('aria-live','polite');summary.setAttribute('aria-describedby',error.id);
 const oldLabel=select.closest('label');oldLabel.replaceWith(wrapper);select.hidden=true;select.tabIndex=-1;wrapper.append(caption,details,select,error);
 const close=(focus=false)=>{details.open=false;if(focus)summary.focus();};
 function refresh(){
  options.replaceChildren();selected.replaceChildren();
  for(const option of select.options){
   const row=document.createElement('label'),checkbox=document.createElement('input'),text=document.createElement('span');checkbox.type='checkbox';checkbox.checked=option.selected;checkbox.disabled=option.disabled||select.disabled;text.textContent=option.textContent;row.append(checkbox,text);options.append(row);
   checkbox.onchange=()=>{option.selected=checkbox.checked;updateSelection();select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));};
  }
  updateSelection();
 }
 function updateSelection(){
  selected.replaceChildren();const values=Array.from(select.selectedOptions);
  for(const option of values){const chip=document.createElement('span');chip.className='multi-picker-chip';chip.textContent=option.textContent;selected.append(chip);}
  if(!values.length)selected.textContent='Choose '+label.toLowerCase();
  summary.setAttribute('aria-label',label+': '+(values.map(o=>o.textContent).join(', ')||'none selected'));
  if(select.validity.valid){error.hidden=true;summary.removeAttribute('aria-invalid');}
 }
 done.onclick=()=>close(true);
 details.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close(true);}else if(event.key==='ArrowDown'&&event.target===summary){event.preventDefault();details.open=true;options.querySelector('input:not(:disabled)')?.focus();}});
 details.addEventListener('focusout',event=>{if(event.relatedTarget){if(!details.contains(event.relatedTarget))close();}else setTimeout(()=>{if(!details.contains(document.activeElement))close();},0);});
 document.addEventListener('click',event=>{if(!wrapper.contains(event.target))close();});
 select.addEventListener('invalid',event=>{event.preventDefault();error.textContent='Select at least one '+(select.name==='schemeIds'?'scheme.':'section.');error.hidden=false;summary.setAttribute('aria-invalid','true');details.open=true;summary.focus();});
 select.addEventListener('change',()=>{Array.from(options.querySelectorAll('input')).forEach((input,i)=>input.checked=select.options[i].selected);updateSelection();});
 select.form?.addEventListener('reset',()=>setTimeout(()=>{close();refresh();error.hidden=true;summary.removeAttribute('aria-invalid');},0));
 refresh();return {refresh};
}
