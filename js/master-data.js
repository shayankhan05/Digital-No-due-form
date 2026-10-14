import {apiFetch} from './api.js';
// One page initialization shares this snapshot. Mutations invalidate it; active
// directory/status, marks and approval data never use this cache.
let initial;
export const loadMasters=()=>initial||=(apiFetch('/api/administration/masters').catch(error=>{initial=null;throw error;}));
window.addEventListener('institution:masters-changed',()=>{initial=null;});
