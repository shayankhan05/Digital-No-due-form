import {isInactive} from './account-state.js';
export const obviousTestFaculty=user=>/^(?:temporary\s+teacher(?:\s|$)|demo\s+(?:(?:java|os|subject)\s+faculty|a\s*\/\s*b\s+faculty)|teacher-browser-|[mt]\d+$)/i.test(String(user?.name||'').trim())||/^teacher-browser-/i.test(String(user?.email||''))||/^teacher\s*\d+$/i.test(String(user?.name||'').trim())&&/@load\.test$/i.test(String(user?.email||''));
export const selectableFaculty=user=>!!user&&!isInactive(user)&&user.authDisabled!==true&&user.configurationSelectable!==false&&!obviousTestFaculty(user);
