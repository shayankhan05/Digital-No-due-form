import {auth} from './firebase-config.js';
import {post} from './api.js';
import {STATUS,statusLabel} from './workflow-model.js';
export {STATUS,statusLabel};
export const STAGE1_TYPES=['subject_faculty','library','accounts'];
export async function getRequiredApprovers(uid){const result=await post('/api/students/workflow',{studentUid:uid});return Object.entries(result.plan.items).map(([id,item])=>({id,...item,type:item.approverType}));}
export async function submitRequest(){return (await post('/api/requests',{})).id;}
const action=(id,body)=>post(`/api/requests/${encodeURIComponent(id)}/actions`,body);
export const actOnStage1Item=(id,approvalId,decision,reason)=>action(id,{action:'stage1',approvalId,decision,reason});
export const actAsMentor=(id,decision,reason)=>action(id,{action:'mentor',decision,reason});
export const actAsHod=(id,decision,reason)=>action(id,{action:'hod',decision,reason});
export const issueHallTicket=id=>action(id,{action:'issue'});
export const resubmit=id=>action(id,{action:'resubmit'});
export const checkAndAdvance=()=>{throw new Error('Use the approval action; advancement is atomic.');};
export const upgradeLegacyRequest=async(id,plan)=>{const {record}=await import('./academic.js');const request=await record('noDueRequests',id);if(!request)throw new Error('Request not found.');return post('/api/students/workflow',{studentUid:request.studentId});};
