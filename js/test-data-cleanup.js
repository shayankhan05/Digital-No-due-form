import {apiFetch,post} from './api.js';
import {escapeHtml as e,busy} from './ui.js';
const endpoint='/api/administration/test-data-cleanup';
const phrase='PURGE TEST DATA';
export function mountTestDataCleanup(host,actor){
 if(!host||actor.role!=='super_admin')return;
 const panel=document.createElement('section');panel.className='card';
 panel.innerHTML='<h2>Test Data Cleanup</h2><p>Scan reviewed test records before purging. Current students, institutional data and shared history are protected.</p><button type="button" class="btn-sm" data-scan>Scan Test Data</button><div data-review></div><p data-status role="status" aria-live="polite"></p>';
 host.append(panel);
 const scan=panel.querySelector('[data-scan]'),review=panel.querySelector('[data-review]'),status=panel.querySelector('[data-status]');
 function report(result){
  review.innerHTML='<h3>Cleanup report</h3><ul>'+Object.entries(result.removed).map(([name,n])=>'<li>'+e(name)+': '+n+' removed</li>').join('')+Object.entries(result.detached||{}).map(([name,n])=>'<li>'+e(name)+': '+n+' preserved records detached</li>').join('')+'</ul><p>Firebase accounts remaining: '+result.firebaseRemaining+' · Integrity issues: '+result.integrityIssues+'</p><p>Encrypted backup ID: '+e(result.backupId)+'</p>';
  status.textContent='Cleanup verified.';
 }
 scan.onclick=()=>busy(scan,async()=>{
  review.replaceChildren();status.textContent='Scanning dependencies…';
  try{
   const p=await apiFetch(endpoint);status.textContent='Scan complete. Nothing was deleted.';
   review.innerHTML='<h3>Reviewed purge candidates</h3><ul>'+Object.entries(p.counts).map(([name,n])=>'<li>'+e(name)+': '+n+'</li>').join('') +Object.entries(p.detach||{}).map(([name,n])=>'<li>'+e(name)+': '+n+' records with derived references to detach</li>').join('')+Object.entries(p.retainedHistory||{}).map(([name,n])=>'<li>'+e(name)+': '+n+' archives retained</li>').join('')+'<li>Firebase test accounts: '+p.firebaseAccounts+'</li></ul><p>Existing integrity issues: '+p.integrityIssues+'</p>'+
    (Object.keys(p.unclassifiedLegacy).length?'<p>Legacy records still needing provenance review: '+e(Object.entries(p.unclassifiedLegacy).map(([k,v])=>v+' '+k).join(', '))+'. They are excluded.</p>':'')+
    p.blocked.map(b=>'<p>'+e(b.collection)+': '+b.count+' · '+e(b.reason)+'</p>').join('')+
    (p.authBlocked?'<p>'+e(p.authBlocked)+'</p>':'')+(!p.backupReady?'<p>Encrypted backup configuration is required before purging.</p>':'');
   if(p.pendingJob){
    const b=document.createElement('button');b.type='button';b.className='btn-sm';b.textContent='Resume Firebase verification';review.append(b);
    b.onclick=()=>busy(b,async()=>{try{report(await post(endpoint+'/resume',{id:p.pendingJob}));}catch(err){status.textContent=err.message;}});return;
   }
   if(!p.total||p.blocked.length||p.authBlocked||!p.backupReady)return;
   review.insertAdjacentHTML('beforeend','<p>This permanently removes only the reviewed records. An encrypted backup is created before deletion.</p><label>Type PURGE TEST DATA<input data-confirm autocomplete="off"></label><button type="button" class="btn-primary" data-purge disabled>Purge Test Data</button>');
   const input=review.querySelector('[data-confirm]'),purge=review.querySelector('[data-purge]');
   input.oninput=()=>purge.disabled=input.value!==phrase;
   purge.onclick=()=>busy(purge,async()=>{if(input.value!==phrase)return;try{report(await post(endpoint+'/purge',{fingerprint:p.fingerprint,confirmation:phrase}));}catch(err){review.replaceChildren();status.textContent=err.message+' Run Scan Test Data again to check the result.';}});
  }catch(err){status.textContent=err.message;}
 });
}
