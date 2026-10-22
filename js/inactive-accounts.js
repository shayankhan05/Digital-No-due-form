import {apiFetch,post} from './api.js';
import {loadMasters} from './master-data.js';
import {escapeHtml as e} from './ui.js';
import {departmentLabel} from './department.js';
import {roleLabel} from './display-labels.js';
import {wireAccountReactivation,exitInstitution,restoreExited} from './account-removal.js';
import {mountPermanentRemoval} from './permanent-removal-ui.js';
export function mountInactiveAccounts(parent,actor,refresh){
 const root=document.createElement('section');root.className='card inactive-panels';root.innerHTML='<h2>Inactive Students / Faculty</h2><p>Inactive accounts are temporarily deactivated. Exited accounts have permanently left and require Super Admin to Restore Institutional Identity.</p>';parent.append(root);
 for(const kind of ['student','faculty']){
  const plural=kind==='student'?'Students':'Faculty',details=document.createElement('details');details.id='inactive-'+kind;details.innerHTML=`<summary>Show Inactive ${plural}</summary><div class="inactive-content"></div>`;root.append(details);const content=details.querySelector('div');let generation=0,department='',cursor=null;
  const load=async(append=false)=>{const run=++generation;details.querySelector('summary').textContent='Hide Inactive '+plural;if(!append){content.innerHTML='<p role="status">Loading inactive accounts...</p>';cursor=null;}
   try{const result=await apiFetch('/api/admin/account-removal',{method:'POST',body:JSON.stringify({action:'directory',kind,status:'inactive',departmentId:department||undefined,cursor:append?cursor:null})});if(run!==generation||!details.open)return;
    if(!append){content.replaceChildren();if(actor.role==='super_admin'&&!sessionStorage.getItem('department-context:'+actor.uid)){const masters=await loadMasters(),label=document.createElement('label');label.innerHTML='Department<select><option value="">All Departments</option>'+masters.departments.map(d=>`<option value="${e(d._id)}">${e(d.name)}</option>`).join('')+'</select>';content.append(label);label.querySelector('select').value=department;label.querySelector('select').onchange=event=>{department=event.target.value;load();};}}
    content.querySelector('.inactive-more')?.remove();cursor=result.cursor;
    if(run!==generation||!details.open)return;
    for(const row of result.rows){const card=document.createElement('article');card.className='inactive-person';card.innerHTML=`<h3>${e(row.name)}</h3><p>${kind==='student'?'USN':'Employee ID'}: ${e(row.identifier)}<br>Email: ${e(row.email)}<br>Department: ${e(departmentLabel(row.department))}<br>${kind==='student'?`Semester: ${e(row.semester)} · Section: ${e(row.section)}`:`Role: ${e(roleLabel(row.role))}`}<br>Deactivated: ${e(row.deactivatedAt?new Date(row.deactivatedAt).toLocaleDateString():'Not available')}<br>Status: ${e(row.accountStatus)}</p><div class="provision-actions"></div>`;const actions=card.querySelector('.provision-actions'),canManage=actor.role==='super_admin'||['student','subject_faculty','mentor'].includes(row.role);
     if(canManage&&row.accountStatus==='inactive'){actions.innerHTML=`<button class="btn-sm" data-reactivate-account="${e(row.uid)}" data-kind="${kind}">Reactivate</button><button class="btn-sm inactive-exit" type="button">Permanent Institutional Exit</button>`;wireAccountReactivation(actions,async()=>{await load();await refresh();});actions.querySelector('.inactive-exit').onclick=async()=>{try{const account=await post('/api/admin/account-removal',{uid:row.uid,preview:true});exitInstitution(account,kind,async()=>{await load();await refresh();});}catch(error){actions.insertAdjacentHTML('beforeend',`<p role="alert">${e(error.message)}</p>`);}};}
     if(actor.role==='super_admin'&&row.accountStatus==='exited'){const restore=document.createElement('button');restore.type='button';restore.className='btn-sm';restore.textContent='Restore Institutional Identity';restore.onclick=async()=>{restore.disabled=true;try{const account=await post('/api/admin/account-removal',{uid:row.uid,preview:true});restoreExited(account,kind,async()=>{await load();await refresh();});}catch(error){actions.insertAdjacentHTML('beforeend','<p role="alert">'+e(error.message)+'</p>');}finally{restore.disabled=false;}};actions.append(restore);}if(actor.role==='super_admin'&&['inactive','exited'].includes(row.accountStatus))mountPermanentRemoval(actions,()=>[row.uid],async()=>{await load();await refresh();},{buttonId:'inactive-delete-'+row.uid,single:true});content.append(card);
    }
    if(!result.rows.length&&!append){const text=document.createElement('p');text.setAttribute('role','status');text.textContent='No inactive '+plural.toLowerCase()+(actor.role==='super_admin'&&!department&&!sessionStorage.getItem('department-context:'+actor.uid)?' in this scope.':' in this department.');content.append(text);}
    if(result.more){const more=document.createElement('button');more.className='btn-sm inactive-more';more.textContent='Load more inactive accounts';more.onclick=()=>load(true);content.append(more);}
   }catch{if(run===generation)content.innerHTML='<p role="alert">Unable to load inactive accounts. Please retry.</p>';}
  };
  details.ontoggle=()=>{if(details.open)load();else{generation++;content.replaceChildren();details.querySelector('summary').textContent='Show Inactive '+plural;}};
 }
}
