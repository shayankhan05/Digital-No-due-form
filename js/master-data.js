import {auth} from './firebase-config.js';
import {apiFetch} from './api.js';
// One page initialization shares this snapshot. Mutations invalidate it; active
// directory/status, marks and approval data never use this cache.
let initial,contextKey;
const key=()=>document.getElementById('managementSemester')?.value||sessionStorage.getItem('semester-context:'+auth.currentUser?.uid+':'+(sessionStorage.getItem('department-context:'+auth.currentUser?.uid)||''))||'5';
export const loadMasters=()=>{const current=(sessionStorage.getItem('department-context:'+auth.currentUser?.uid)||'')+':'+key();if(contextKey!==current){initial=null;contextKey=current;}return initial||=(apiFetch('/api/administration/masters').catch(error=>{initial=null;throw error;}));};
window.addEventListener('institution:masters-changed',()=>{initial=null;});
