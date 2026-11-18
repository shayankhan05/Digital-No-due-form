// Current marks limits apply to standard assessments without rewriting stored history.
const limits={ia1:25,ia2:25,assignment:10};
const aliases={internalassessment1:'ia1',internalassessment2:'ia2',ia1:'ia1',ia2:'ia2',assignment:'assignment'};
const key=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function assessmentComponents(components=[]){return (components||[]).map(component=>{const id=key(component.id),label=key(component.label),standard=Object.hasOwn(limits,id)?id:Object.hasOwn(aliases,label)?aliases[label]:null;return {...component,max:standard?limits[standard]:component.max};});}
export const defaultComponents=[{id:'ia1',label:'IA1',max:25},{id:'ia2',label:'IA2',max:25},{id:'assignment',label:'Assignment',max:10}];
export const assessmentOffering=offering=>offering?{...offering,components:assessmentComponents(offering.components)}:offering;
