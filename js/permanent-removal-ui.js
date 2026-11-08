import {post} from './api.js';
import {escapeHtml as e,busy} from './ui.js';
const dependencyNames={
 'retain history presentationIdentityJournal':'Completed identity changes kept',
 'retain history presentationWorkflowArchives':'Archived workflow history kept',
 'retain history bulkAccountJobs':'Historical account records kept',
 'retain history bulkImportJobs':'Historical import records kept',
 'retain history superAdminAudit':'Audit records kept'
};
const collectionNames={users:'Account',students:'Student profile',uniqueIdentities:'Identity reservations',enrollments:'Class enrollments',clearancePlans:'Clearance plans',officeStudentSearch:'Directory search records',provisioningJobs:'Account setup records',noDueRequests:'No-Due requests',hallTickets:'Hall tickets',offerings:'Subject offerings',sectionDetails:'Section assignments'};
function dependencyLabel(key){
 if(dependencyNames[key])return dependencyNames[key];
 const split=key.lastIndexOf(' '),action=key.slice(0,split),collection=key.slice(split+1);
 const subject=collectionNames[collection]||collection.replace(/[A-Z]/g,c=>' '+c.toLowerCase());
 return ({remove:'Remove',detach:'Detach', 'retain history':'Keep history for','cancel request':'Cancel','cancel approval':'Cancel'})[action]+' '+subject.toLowerCase();
}
async function reviewCascade(uid,refresh){
 const preview=await post('/api/admin/accounts/cascade-preflight',{accountIds:[uid]});
 const dialog=document.createElement('dialog');dialog.className='card';
 dialog.innerHTML=`<h2>Review Cascade Delete</h2><dl class="cascade-identity"><dt>Name</dt><dd>${e(preview.name||'Not provided')}</dd>${preview.usn?`<dt>USN</dt><dd>${e(preview.usn)}</dd>`:preview.facultyId?`<dt>Employee ID</dt><dd>${e(preview.facultyId)}</dd>`:''}<dt>Email</dt><dd>${e(preview.email||'Not provided')}</dd></dl><p>Deleting this account will also remove or detach the following dependent records.</p><p>Permanent Institutional Exit disables login and preserves the account's institutional history. Cascade Delete removes the account and its operational mappings.</p><ul>${Object.entries(preview.counts).filter(([,n])=>n).map(([label,n])=>`<li>${e(dependencyLabel(label))}: ${n}</li>`).join('')}</ul>${preview.warnings.map(w=>`<p>${e(w)}</p>`).join('')}${preview.blocked.length?`<p role="alert">Unresolved dependencies: ${e(preview.blocked.join(', '))}. No deletion is available.</p>`:''}<form><label>Reason<textarea name="reason" required maxlength="1000"></textarea></label><label class="confirmation-row"><input name="confirmation" type="checkbox" required> I understand that this account and its mapped operational records will be permanently deleted and this action cannot be undone.</label><div class="provision-actions"><button type="submit" class="btn-primary" disabled>Permanently Delete Account</button><button type="button" class="btn-sm" data-close>Close</button></div><p role="status"></p></form>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.querySelector('[data-close]').onclick=()=>dialog.close();
 let done=false,pending=false;
 const form=dialog.querySelector('form'),requestId=preview.resumeRequestId||crypto.randomUUID();
 const {reason,confirmation}=form.elements,submit=form.querySelector('[type=submit]');
 const ready=()=>!done&&!pending&&!preview.blocked.length&&confirmation.checked&&reason.value.trim().length>0&&reason.value.trim().length<=1000;
 const update=()=>{submit.disabled=!ready();};
 form.addEventListener('input',update);
 form.onsubmit=async event=>{
  event.preventDefault();if(!ready())return;
  pending=true;update();
  const status=form.querySelector('[role=status]');
  try{
   // The unchanged API expects this confirmation token.
   await post('/api/admin/accounts/cascade-delete',{accountIds:[uid],requestId,fingerprint:preview.fingerprint,reason:reason.value.trim(),typed:'DELETE',confirmation:true});
   done=true;submit.hidden=true;status.textContent='Account permanently deleted.';await refresh();
  }catch(error){status.textContent=error.message;}
  finally{pending=false;update();}
 };dialog.showModal();
}
export function mountPermanentRemoval(host,selection,refresh,{buttonId='bulkPermanentDelete',single=false}={}){
 const button=document.createElement('button');button.type='button';button.className='btn-sm';button.id=buttonId;button.textContent=single?'Hard Delete':'Hard Delete Eligible Only';(host.querySelector('#bulkActions')||host).append(button);
 button.onclick=()=>busy(button,async()=>{const ids=selection();if(!ids.length)return;const preview=await post('/api/admin/accounts/delete-preflight',{accountIds:ids,single}),safe=preview.rows.filter(r=>r.classification==='SAFE_TO_DELETE'),dialog=document.createElement('dialog');dialog.className='card';dialog.innerHTML=`<h2>Review Hard Delete Eligibility</h2><p>${preview.selected} selected · ${safe.length} safe to permanently delete</p><div class="table-scroll"><table><thead><tr><th>Account</th><th>Classification</th><th>Reason</th></tr></thead><tbody>${preview.rows.map(r=>`<tr><td>${e(r.name||r.uid)}</td><td>${e(single?r.category||r.classification:(r.category||r.classification).replaceAll('_',' '))}</td><td>${e(r.reason)}</td></tr>`).join('')}</tbody></table></div><label class="confirmation-row"><input type="checkbox" id="permanentDeleteConfirmation" class="action-confirmation" ${safe.length?'':'disabled'}> ${single?'I understand this account will be permanently deleted and this cannot be undone.':'Permanently remove only the safe accounts and their unused setup data. This cannot be undone.'}</label><div class="provision-actions"><button id="confirmPermanentDelete" class="btn-primary" disabled>${single?'Permanently Delete Account':'Permanently Delete '+safe.length+' Safe Accounts'}</button><button id="cancelPermanentDelete" class="btn-sm">Close</button></div><p id="permanentDeleteResult" role="status"></p>`;document.body.append(dialog);dialog.showModal();if(single&&preview.rows.some(r=>r.classification==='HAS_HISTORY')){const cascade=document.createElement('button');cascade.type='button';cascade.className='btn-sm';cascade.textContent='Review Cascade Delete';dialog.querySelector('.provision-actions').prepend(cascade);cascade.onclick=()=>busy(cascade,async()=>{await reviewCascade(ids[0],refresh);dialog.remove();});}dialog.querySelector('#cancelPermanentDelete').onclick=()=>dialog.remove();dialog.querySelector('input').onchange=event=>dialog.querySelector('#confirmPermanentDelete').disabled=!event.target.checked||!safe.length;const requestId=crypto.randomUUID();dialog.querySelector('#confirmPermanentDelete').onclick=event=>busy(event.target,async()=>{const result=await post('/api/admin/accounts/permanent-delete',{accountIds:safe.map(r=>r.uid),requestId,confirmation:true});dialog.querySelector('#permanentDeleteResult').innerHTML=`${result.deleted} removed · ${result.skipped} retained${result.rows.filter(r=>!r.deleted).map(r=>`<p>${e(r.name||r.uid)}: ${e(r.reason)}</p>`).join('')}`;await refresh();if(!result.retryRequired){dialog.querySelector('#confirmPermanentDelete').hidden=true;dialog.querySelector('input').disabled=true;}else dialog.querySelector('#permanentDeleteResult').append(' Retry this confirmation to finish the pending operation safely.');});});
}
