import {departmentLabel} from './department.js';
import {roleLabel,accountLabel} from './display-labels.js';
export const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export function errorState(target, error) { target.innerHTML = `<div class="card" role="alert">${escapeHtml(error.message || error)}</div>`; }
export function profileHTML(profile) {
  if(profile.scope==='institution')profile={...profile,department:undefined,institution:'Acharya Institute of Technology (AIT)'};
  return `<div class="card"><h2>${escapeHtml(accountLabel(profile))}</h2>${["usn","facultyId","email","phone","institution","department","scheme","semester","section","role"].filter(k => profile[k] !== undefined && (k!=='scheme'||profile.role==='student')).map(k => `<div class="profile-info-row"><span>${escapeHtml(k)}</span><strong>${escapeHtml(k==='department'?departmentLabel(profile[k]):k==='role'?roleLabel(profile[k]):profile[k])}</strong></div>`).join("")}<a href="password-settings.html">Change password</a></div>`;
}
export async function busy(button, action) {
  const label = button.textContent; button.disabled = true; button.textContent = "Working…";
  try { await action(); } catch (error) { alert(error.message); }
  finally { button.disabled = false; button.textContent = label; }
}
