import {auth} from './firebase-config.js';
import {API_BASE_URL} from './api-config.js';
export async function publicPost(path,body){const base=new URL(API_BASE_URL);if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw new Error('The backend URL must use HTTPS.');const response=await fetch(new URL(path,base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error?.message||'Operation failed.'),{code:result.error?.code||'api/error'});return result;}
export async function apiFetch(path,options={}){
  if(!API_BASE_URL)throw new Error('API_BASE_URL is not configured.');
  const base=new URL(API_BASE_URL);if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw new Error('The backend URL must use HTTPS.');
  if(!auth.currentUser)throw Object.assign(new Error('Sign in first.'),{code:'unauthenticated'});
  const departmentId=sessionStorage.getItem('department-context:'+auth.currentUser.uid);const request=async refresh=>fetch(new URL(path,base),{...options,headers:{'Content-Type':'application/json',...options.headers,...(departmentId?{'X-Department-Id':departmentId}:{}),Authorization:`Bearer ${await auth.currentUser.getIdToken(refresh)}`}});
  let response=await request(false);if(response.status===401)response=await request(true);const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error?.message||'Operation failed.'),{code:result.error?.code||'api/error'});return result;
}
export const post=(path,body)=>apiFetch(path,{method:'POST',body:JSON.stringify(body)});
